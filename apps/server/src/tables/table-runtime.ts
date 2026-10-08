import {
  createTable,
  holdemReducer,
  isHandInProgress,
  nextHandPositions,
  viewFor,
  type HoldemAction,
  type HoldemEvent,
  type HoldemResult,
  type TableConfig,
  type TableState,
} from '@naipes/engine';
import type {
  Ack,
  PlayerAction,
  SocketError,
  TableClosed,
  TableClosedReason,
  TableDegraded,
  TableUpdate,
} from '@naipes/shared';
import { socketError, toSocketError } from './errors';
import { HandRecorder } from './hand-recorder';
import { persistRetryDelay } from './persist-retry';
import { PlayerTimers, type PlayerTimerToken } from './player-timers';
import type { DeckSource, Scheduler, TableLogger, Timer } from './ports';
import { HandAlreadyPersistedError, type HandRecord, type TableStore } from './table-store';
import type { TableTimings } from './table-settings';
import {
  chipsOnTable,
  isBotId,
  playerLeftEvents,
  refundsFromState,
  toHoldemAction,
} from './table-state-helpers';

export { isBotId };

export type TableMessage =
  | { type: 'update'; update: TableUpdate }
  | { type: 'closed'; closed: TableClosed }
  | { type: 'degraded'; degraded: TableDegraded };
export type TableListener = (message: TableMessage) => void;
export type TableResult<T extends object = object> = Ack<T>;
export type TableStatus = 'open' | 'running' | 'closed';

export interface TableHooks {
  /** A hand settled or was voided, and it was saved. */
  afterHand(table: TableRuntime): void;
  /**
   * A player's seat was freed; `cashOut` was already credited to the wallet or the house (when the
   * seat was freed by a hand, once that hand was saved).
   */
  playerLeft(table: TableRuntime, playerId: string, cashOut: number): void;
  /** Any applied change. */
  changed(table: TableRuntime): void;
  closed(table: TableRuntime): void;
}

export interface TableRuntimeDeps {
  id: string;
  config: TableConfig;
  timings: TableTimings;
  scheduler: Scheduler;
  deckSource: DeckSource;
  /** Seats, cash-outs and hands; it tells bots (house chips) from humans (wallets). */
  store: TableStore;
  logger: TableLogger;
  hooks?: Partial<TableHooks>;
}

type Applied = { ok: true; events: readonly HoldemEvent[] } | { ok: false; error: SocketError };

const fail = (error: SocketError): { ok: false; error: SocketError } => ({ ok: false, error });
const internalError = () => fail(socketError('INTERNAL', 'Internal error'));
const tableClosed = () => fail(socketError('TABLE_CLOSED', 'The table is closed'));
const OK = { ok: true } as const;

type TurnClock = { readonly handNumber: number; readonly seat: number; readonly deadline: number };
type Left = { playerId: string; seat: number; cashOut: number };
/** A hand that ended but could not be saved yet; `left`: seats it freed (hooks wait for the save). */
type Unsaved = { record: HandRecord; left: Left[] };

const endsHand = (events: readonly HoldemEvent[]): boolean =>
  events.some((e) => e.type === 'handSettled' || e.type === 'handVoided');

/**
 * Authoritative, in-memory runtime of one Hold'em table (spec §3.3, §5.1, §5.2, §6.2).
 *
 * Every public command runs through a FIFO promise queue, one at a time, including its store awaits.
 * A hand that ends is saved with `store.persistHand` inside the queue before the next one can start;
 * while that fails the table is degraded (spec §3.3): it retries, deals no hand, takes no new seat
 * and queues leaves until the save goes through.
 * Each applied change bumps `seq` once and sends every subscriber one `update` with its own
 * `viewFor`. The `TableState`, the deck and hole cards never leave this class except through
 * `viewFor`: they are never logged nor put in error messages.
 */
export class TableRuntime {
  readonly id: string;
  protected state: TableState;
  /** Chips that must be on the table: buy-ins minus cash-outs. Checked after every change. */
  protected expectedChips = 0;
  private readonly deps: TableRuntimeDeps;
  private readonly created: number;
  private currentSeq = 0;
  private closedReason: TableClosedReason | null = null;
  private readonly listeners = new Map<string, TableListener>();
  private queue: Promise<unknown> = Promise.resolve();
  /** Pending start of the next hand; stays set until the queued start runs. */
  private startTimer: Timer | null = null;
  /**
   * Deadline of the current turn. Reset when `(handNumber, toAct)` changes or a betting round
   * starts; each reset replaces the object and reschedules `turnTimer`.
   */
  private turnClock: TurnClock | null = null;
  /** Fires the `timeout` of `turnClock`; null when nobody is to act. */
  private turnTimer: Timer | null = null;
  /** Disconnect grace and sitting-out leave timers. */
  private readonly playerTimers: PlayerTimers;
  private dealingStopped = false;
  private readonly recorder = new HandRecorder();
  /** Set while the table is degraded. */
  private unsaved: Unsaved | null = null;
  private retryTimer: Timer | null = null;
  private retryAttempt = 0;
  /** Leaves asked for while degraded: resolved with the next successful `persistHand`. */
  private readonly pendingLeaves = new Set<string>();

  constructor(deps: TableRuntimeDeps) {
    this.deps = deps;
    this.id = deps.id;
    this.state = createTable(deps.config);
    this.created = deps.scheduler.now();
    this.playerTimers = new PlayerTimers(deps.scheduler);
  }

  // ------------------------------------------------------------ queries

  get status(): TableStatus {
    if (this.closedReason) return 'closed';
    return isHandInProgress(this.state.hand) ? 'running' : 'open';
  }

  get seq(): number {
    return this.currentSeq;
  }

  get createdAt(): number {
    return this.created;
  }

  /** The last hand is not saved yet: no hand starts and no new player sits until it is. */
  get degraded(): boolean {
    return this.unsaved !== null;
  }

  /** The player asked to leave while degraded; the seat is freed once the hand is saved. */
  isLeavePending(playerId: string): boolean {
    return this.pendingLeaves.has(playerId);
  }

  /** True after `stopDealing` or once closed: no new hand will start. */
  get closing(): boolean {
    return this.dealingStopped || this.closedReason !== null;
  }

  seatOf(playerId: string): number | null {
    const seat = this.state.seats.findIndex((s) => s?.playerId === playerId);
    return seat === -1 ? null : seat;
  }

  playerIds(): string[] {
    return this.state.seats.flatMap((s) => (s ? [s.playerId] : []));
  }

  humanCount(): number {
    return this.playerIds().filter((id) => !isBotId(id)).length;
  }

  playerCount(): number {
    return this.playerIds().length;
  }

  hasFreeSeat(): boolean {
    return this.state.seats.some((s) => s === null);
  }

  isHandInProgress(): boolean {
    return isHandInProgress(this.state.hand);
  }

  stackOf(playerId: string): number | null {
    const seat = this.seatOf(playerId);
    return seat === null ? null : (this.state.seats[seat]?.stack ?? null);
  }

  /** Stacks plus the pot of the hand in progress. */
  chipsOnTable(): number {
    return chipsOnTable(this.state);
  }

  /** One listener per player (a new one replaces the old); it gets the current update right away. */
  subscribe(playerId: string, listener: TableListener): () => void {
    if (this.closedReason) {
      this.send(playerId, listener, this.closedMessage(this.closedReason));
      return () => {};
    }
    this.listeners.set(playerId, listener);
    this.send(playerId, listener, { type: 'update', update: this.snapshot(playerId) });
    if (this.degraded) this.send(playerId, listener, this.degradedMessage(true));
    return () => {
      if (this.listeners.get(playerId) === listener) this.listeners.delete(playerId);
    };
  }

  snapshot(playerId: string): TableUpdate {
    return this.buildUpdate(playerId, []);
  }

  // ------------------------------------------------------------ commands

  sit(
    playerId: string,
    buyIn: number,
    postBlindsToEnter?: boolean,
  ): Promise<TableResult<{ seat: number }>> {
    return this.enqueue('sit', async () => {
      if (this.closedReason) return tableClosed();
      if (this.seatOf(playerId) !== null) {
        return fail(socketError('INVALID_ACTION', 'Player is already seated at this table'));
      }
      if (!Number.isSafeInteger(buyIn) || buyIn <= 0) {
        return fail(socketError('INVALID_AMOUNT', 'Buy-in must be a positive integer'));
      }
      if (this.degraded) return internalError();
      const seat = this.state.seats.findIndex((s) => s === null);
      if (seat === -1) return fail(socketError('TABLE_FULL', 'The table is full'));
      const stored = { tableId: this.id, seat, playerId };
      const outcome = await this.deps.store.sitDown({ ...stored, buyIn });
      if (outcome === 'insufficient') {
        return fail(socketError('INSUFFICIENT_CHIPS', 'Not enough chips for the buy-in'));
      }
      let result: HoldemResult;
      try {
        result = this.apply({ type: 'sit', playerId, seat, buyIn, postBlindsToEnter });
      } catch (error) {
        await this.standUpQuietly({ ...stored, cashOut: buyIn });
        throw error;
      }
      if (!result.ok) {
        await this.standUpQuietly({ ...stored, cashOut: buyIn });
        return fail(toSocketError(result.error));
      }
      this.expectedChips += buyIn;
      if (!(await this.commit(result))) return internalError();
      return { ok: true, seat };
    });
  }

  act(playerId: string, seq: number, action: PlayerAction): Promise<TableResult> {
    return this.enqueue('act', async () => {
      if (this.closedReason) return tableClosed();
      if (this.seatOf(playerId) === null) {
        return fail(socketError('NOT_AT_TABLE', 'Player is not seated at this table'));
      }
      if (seq !== this.currentSeq) {
        return fail(socketError('STALE_SEQ', 'The table changed; act on the latest update'));
      }
      const result = await this.applyAndCommit(toHoldemAction(playerId, action));
      return result.ok ? { ok: true } : result;
    });
  }

  sitOut(playerId: string): Promise<TableResult> {
    return this.enqueue('sitOut', async () => {
      if (this.closedReason) return tableClosed();
      const result = await this.applyAndCommit({ type: 'sitOut', playerId });
      return result.ok ? { ok: true } : result;
    });
  }

  sitIn(playerId: string, postBlindsToEnter?: boolean): Promise<TableResult> {
    return this.enqueue('sitIn', async () => {
      if (this.closedReason) return tableClosed();
      const result = await this.applyAndCommit({ type: 'sitIn', playerId, postBlindsToEnter });
      return result.ok ? { ok: true } : result;
    });
  }

  /** `cashOut` is null when the player is in a hand: they leave (and cash out) when it settles. */
  leave(playerId: string): Promise<TableResult<{ cashOut: number | null }>> {
    return this.enqueue('leave', async () => {
      if (this.closedReason) return tableClosed();
      const result = await this.requestLeave(playerId);
      if (!result.ok) return result;
      const left = playerLeftEvents(result.events).find((e) => e.playerId === playerId);
      return { ok: true, cashOut: left ? left.cashOut : null };
    });
  }

  /**
   * A seated player's connection dropped: after `disconnectGraceMs` they sit out (spec §5.3).
   * No-op for a player who is not seated or whose grace is already running.
   */
  disconnected(playerId: string): void {
    if (this.closedReason || this.seatOf(playerId) === null) return;
    this.playerTimers.start('grace', playerId, this.deps.timings.disconnectGraceMs, (token) => {
      void this.enqueue('disconnectGrace', () => this.graceExpired(playerId, token));
    });
  }

  /** Cancels the disconnect grace, if any. */
  reconnected(playerId: string): void {
    this.playerTimers.cancel('grace', playerId);
  }

  /** No new hand starts from now on; the hand in progress plays out (shutdown, spec §5.5). */
  stopDealing(): void {
    this.dealingStopped = true;
    this.retryTimer?.cancel();
    this.retryTimer = null;
    this.startTimer?.cancel();
    this.startTimer = null;
  }

  /** Voids the hand in progress, cashes everybody out and notifies `closed`. Idempotent. */
  async close(reason: TableClosedReason): Promise<void> {
    await this.enqueue('close', async () => {
      await this.shutdown(reason);
      return { ok: true };
    });
  }

  /**
   * Closes with reason `empty` only if no human is seated when the command runs: a human `sit` queued
   * before it (e.g. still awaiting its debit) wins. Resolves to whether the table was closed.
   */
  async closeIfEmpty(): Promise<boolean> {
    const result = await this.enqueue('closeIfEmpty', async () => {
      if (this.closedReason || this.humanCount() > 0) return { ok: true, closed: false };
      await this.shutdown('empty');
      return { ok: true, closed: true };
    });
    return result.ok && result.closed;
  }

  // ------------------------------------------------------------ internals

  /** Every reducer call goes through here (test seam). */
  protected apply(action: HoldemAction, state: TableState = this.state): HoldemResult {
    return holdemReducer(state, action);
  }

  private enqueue<T extends object>(
    name: string,
    command: () => Promise<TableResult<T>>,
  ): Promise<TableResult<T>> {
    const run = async (): Promise<TableResult<T>> => {
      try {
        return await command();
      } catch (error) {
        this.logError(`command "${name}" failed`, error);
        await this.recover();
        return internalError();
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next;
    return next;
  }

  /** After an exception: void the hand in progress and keep going; close the table if that fails too. */
  private async recover(): Promise<void> {
    if (this.closedReason) return;
    try {
      if (this.isHandInProgress()) {
        const result = this.apply({ type: 'voidHand' });
        if (!result.ok) throw new Error(`voidHand rejected with ${result.error.code}`);
        await this.commit(result);
      } else {
        this.scheduleNextHand();
      }
    } catch (error) {
      this.logError('recovery failed, closing the table', error);
      try {
        await this.shutdown('error');
      } catch (closeError) {
        this.logError('could not close the table', closeError);
      }
    }
  }

  /**
   * Applies and commits `action`. Seats it frees outside the end of a hand are stood up in the store
   * first: if that fails nothing changes (the player stays seated) and the result is INTERNAL.
   */
  private async applyAndCommit(action: HoldemAction): Promise<Applied> {
    const result = this.apply(action);
    if (!result.ok) return fail(toSocketError(result.error));
    if (!endsHand(result.events)) {
      for (const e of playerLeftEvents(result.events)) {
        try {
          await this.deps.store.standUp({
            tableId: this.id,
            seat: e.seat,
            playerId: e.playerId,
            cashOut: e.cashOut,
          });
        } catch (error) {
          this.logError('could not stand a player up', error);
          return internalError();
        }
      }
    }
    if (!(await this.commit(result))) return internalError();
    return { ok: true, events: result.events };
  }

  /** `leave`, or, while degraded and between hands, a pending leave resolved by the next save. */
  private async requestLeave(playerId: string): Promise<Applied> {
    if (this.degraded && this.seatOf(playerId) !== null && !this.isHandInProgress()) {
      this.pendingLeaves.add(playerId);
      return { ok: true, events: [] };
    }
    return this.applyAndCommit({ type: 'leave', playerId });
  }

  /**
   * Adopts an applied reducer result: seq, cash-outs, notifications, conservation check, hooks and
   * the next hand. Returns false if the table had to be closed.
   */
  private async commit(result: {
    state: TableState;
    events: readonly HoldemEvent[];
  }): Promise<boolean> {
    this.state = result.state;
    this.currentSeq++;
    this.recorder.observe(result.events);
    this.updateTurnClock(result.events);
    this.syncPlayerTimers();
    const left: Left[] = playerLeftEvents(result.events).map((e) => ({
      playerId: e.playerId,
      seat: e.seat,
      cashOut: e.cashOut,
    }));
    for (const e of left) this.expectedChips -= e.cashOut;
    this.broadcast(result.events);
    for (const e of left) this.listeners.delete(e.playerId);

    const onTable = this.chipsOnTable();
    if (onTable !== this.expectedChips) {
      this.deps.logger.error(
        `Table ${this.id}: chip conservation failed (expected ${this.expectedChips}, found ${onTable}); closing`,
      );
      await this.shutdown('error');
      return false;
    }
    const record = this.recorder.build(this.id, this.state, result.events);
    if (record) {
      await this.persist({ record, left });
    } else {
      // Freed outside the end of a hand: already stood up in the store.
      this.seatsFreed(left);
    }
    this.callHook('changed', (h) => h.changed?.(this));
    this.scheduleNextHand();
    return true;
  }

  /** Saves an ended hand; on failure the table becomes degraded and retries on its own. */
  private async persist(unsaved: Unsaved): Promise<void> {
    try {
      await this.deps.store.persistHand(unsaved.record);
    } catch (error) {
      this.logError('could not save the hand, retrying', error);
      this.unsaved = unsaved;
      this.retryAttempt = 0;
      this.broadcastMessage(this.degradedMessage(true));
      this.scheduleRetry();
      return;
    }
    this.handSaved(unsaved.left);
  }

  private handSaved(left: Left[]): void {
    this.seatsFreed(left);
    this.callHook('afterHand', (h) => h.afterHand?.(this));
  }

  private seatsFreed(left: Left[]): void {
    for (const e of left) {
      this.callHook('playerLeft', (h) => h.playerLeft?.(this, e.playerId, e.cashOut));
    }
  }

  private scheduleRetry(): void {
    if (this.closing) return;
    this.retryAttempt++;
    this.retryTimer = this.deps.scheduler.schedule(persistRetryDelay(this.retryAttempt), () => {
      void this.enqueue('persistRetry', () => this.retryPersist());
    });
  }

  /**
   * Saves the unsaved hand again, now with the pending leaves as leavers of that hand (their stacks
   * have not moved since). Only once it is saved do those seats go through the reducer.
   */
  private async retryPersist(): Promise<TableResult> {
    this.retryTimer = null;
    const unsaved = this.unsaved;
    if (this.closedReason || !unsaved) return OK;
    let state = this.state;
    const events: HoldemEvent[] = [];
    for (const playerId of this.pendingLeaves) {
      if (this.seatOf(playerId) === null) continue;
      const result = this.apply({ type: 'leave', playerId }, state);
      if (!result.ok) throw new Error(`pending leave rejected with ${result.error.code}`);
      state = result.state;
      events.push(...result.events);
    }
    const leaving = playerLeftEvents(events);
    const leavingSeats = new Set(leaving.map((e) => e.seat));
    const record: HandRecord = {
      ...unsaved.record,
      stacks: unsaved.record.stacks.filter((s) => !leavingSeats.has(s.seat)),
      leavers: [
        ...unsaved.record.leavers,
        ...leaving.map((e) => ({ playerId: e.playerId, seat: e.seat, cashOut: e.cashOut })),
      ],
    };
    try {
      await this.saveRetried(record);
    } catch (error) {
      this.logError('could not save the hand, retrying', error);
      this.scheduleRetry();
      return OK;
    }
    this.unsaved = null;
    this.pendingLeaves.clear();
    this.broadcastMessage(this.degradedMessage(false));
    this.handSaved(unsaved.left);
    if (events.length > 0) {
      // Already credited by the save: `commit` only adopts them and fires `playerLeft`.
      await this.commit({ state, events });
    } else {
      this.scheduleNextHand();
    }
    return OK;
  }

  /**
   * `persistHand` for a retry. If an earlier attempt already committed (its acknowledgement was
   * lost), the hand counts as saved; the leavers that were not in that committed record are stood up
   * one by one (a failure here throws and the next retry continues with the ones still seated).
   */
  private async saveRetried(record: HandRecord): Promise<void> {
    try {
      await this.deps.store.persistHand(record);
      return;
    } catch (error) {
      if (!(error instanceof HandAlreadyPersistedError)) throw error;
      this.deps.logger.warn(
        `Table ${this.id}: hand ${record.handNumber} was already saved (lost acknowledgement)`,
      );
      for (const l of error.unsavedLeavers) {
        await this.deps.store.standUp({ tableId: this.id, ...l });
      }
    }
  }

  private updateTurnClock(events: readonly HoldemEvent[]): void {
    const hand = this.state.hand;
    if (!isHandInProgress(hand) || hand.toAct === null) {
      this.stopTurnClock();
      return;
    }
    const current = this.turnClock;
    const newRound = events.some((e) => e.type === 'streetDealt');
    if (
      current &&
      !newRound &&
      current.handNumber === hand.handNumber &&
      current.seat === hand.toAct
    ) {
      return;
    }
    const { turnTimeoutMs } = this.deps.timings;
    const clock: TurnClock = {
      handNumber: hand.handNumber,
      seat: hand.toAct,
      deadline: this.deps.scheduler.now() + turnTimeoutMs,
    };
    this.turnClock = clock;
    this.turnTimer?.cancel();
    this.turnTimer = this.deps.scheduler.schedule(turnTimeoutMs, () => {
      void this.enqueue('turnTimeout', () => this.turnExpired(clock));
    });
  }

  private stopTurnClock(): void {
    this.turnClock = null;
    this.turnTimer?.cancel();
    this.turnTimer = null;
  }

  /** Acts for the player to act (check if free, else fold, then sitting out: ADR 0008). */
  private async turnExpired(clock: TurnClock): Promise<TableResult> {
    // Somebody acted (or a street was dealt) since the timer fired: the clock is stale.
    if (this.closedReason || this.turnClock !== clock) return OK;
    const playerId = this.state.seats[clock.seat]?.playerId;
    if (!playerId) throw new Error(`no player at the seat to act (${clock.seat})`);
    const result = this.apply({ type: 'timeout', playerId });
    // A rejected timeout would leave the hand stuck: let `recover` void it.
    if (!result.ok) throw new Error(`timeout rejected with ${result.error.code}`);
    await this.commit(result);
    return OK;
  }

  /**
   * Keeps the per-player timers in line with the seats after every change: a seat that is
   * `sitting_out` has a leave timer (started when it got there), any other seat has none, and a
   * freed seat loses its disconnect grace too.
   */
  private syncPlayerTimers(): void {
    const seated = new Set<string>();
    const sittingOut = new Set<string>();
    for (const seat of this.state.seats) {
      if (!seat) continue;
      seated.add(seat.playerId);
      if (seat.status === 'sitting_out') sittingOut.add(seat.playerId);
    }
    for (const id of this.playerTimers.playerIds('grace')) {
      if (!seated.has(id)) this.playerTimers.cancel('grace', id);
    }
    for (const id of this.playerTimers.playerIds('sittingOut')) {
      if (!sittingOut.has(id)) this.playerTimers.cancel('sittingOut', id);
    }
    const { sittingOutMaxMs } = this.deps.timings;
    for (const id of sittingOut) {
      this.playerTimers.start('sittingOut', id, sittingOutMaxMs, (token) => {
        void this.enqueue('sittingOutMax', () => this.sittingOutExpired(id, token));
      });
    }
  }

  private async graceExpired(playerId: string, token: PlayerTimerToken): Promise<TableResult> {
    if (!this.playerTimers.take('grace', playerId, token) || this.closedReason) return OK;
    const result = await this.applyAndCommit({ type: 'sitOut', playerId });
    // INVALID_ACTION: already sitting out (or leaving).
    if (!result.ok && result.error.code !== 'INVALID_ACTION') {
      this.deps.logger.warn(`Table ${this.id}: grace sit-out rejected (${result.error.code})`);
    }
    return OK;
  }

  /** The normal leave path: credits the wallet (or the house) and fires the hooks. */
  private async sittingOutExpired(playerId: string, token: PlayerTimerToken): Promise<TableResult> {
    if (!this.playerTimers.take('sittingOut', playerId, token) || this.closedReason) return OK;
    const result = await this.requestLeave(playerId);
    if (!result.ok) {
      this.deps.logger.warn(`Table ${this.id}: sitting-out leave rejected (${result.error.code})`);
    }
    return OK;
  }

  private scheduleNextHand(): void {
    if (this.closing || this.degraded || this.startTimer || this.isHandInProgress()) return;
    if (nextHandPositions(this.state) === null) return;
    this.startTimer = this.deps.scheduler.schedule(this.deps.timings.betweenHandsMs, () => {
      void this.enqueue('startHand', () => this.startHand());
    });
  }

  private async startHand(): Promise<TableResult> {
    this.startTimer = null;
    if (
      this.closing ||
      this.degraded ||
      this.isHandInProgress() ||
      nextHandPositions(this.state) === null
    ) {
      return OK;
    }
    const result = this.apply({ type: 'postBlinds', deck: this.deps.deckSource.nextDeck() });
    if (!result.ok) {
      this.deps.logger.error(`Table ${this.id}: could not start a hand (${result.error.code})`);
      this.scheduleNextHand();
      return fail(toSocketError(result.error));
    }
    await this.commit(result);
    return { ok: true };
  }

  /**
   * Closes the table. Except for `error`, the hand in progress is voided (and saved as such) and
   * everybody leaves through the reducer (and gets a last update). With `error` nothing goes through
   * the reducer: each player gets the stack they had at the start of the hand in progress, or their
   * current stack. Every seat is stood up in the store; failures are logged (the recovery at startup
   * returns what is left in the store).
   */
  private async shutdown(reason: TableClosedReason): Promise<void> {
    if (this.closedReason) return;
    this.closedReason = reason;
    this.startTimer?.cancel();
    this.startTimer = null;
    this.retryTimer?.cancel();
    this.retryTimer = null;
    this.stopTurnClock();
    this.playerTimers.cancelAll();

    // A hand still unsaved gets one last try. If it fails, nobody is stood up: the store keeps the
    // last saved (pre-hand) stacks for the startup recovery, so the unsaved hand is in effect voided
    // (ADR 0004). Standing some seats up at post-hand stacks would mix both and break invariant 1.
    let touchStore = true;
    if (this.unsaved) {
      try {
        await this.saveRetried(this.unsaved.record);
        this.seatsFreed(this.unsaved.left);
      } catch (error) {
        touchStore = false;
        this.logError('could not save the hand before closing; seats left for recovery', error);
        this.seatsFreed(this.unsaved.left);
      }
      this.unsaved = null;
      this.pendingLeaves.clear();
    }

    const events: HoldemEvent[] = [];
    if (reason !== 'error') {
      try {
        if (this.isHandInProgress()) {
          const voided: HoldemEvent[] = [];
          this.applyInPlace({ type: 'voidHand' }, voided);
          events.push(...voided);
          await this.saveQuietly(this.recorder.build(this.id, this.state, voided));
        }
        for (const playerId of this.playerIds())
          this.applyInPlace({ type: 'leave', playerId }, events);
      } catch (error) {
        this.logError('could not cash out through the reducer', error);
      }
    }
    const refunds: Left[] = [
      ...playerLeftEvents(events).map((e) => ({
        playerId: e.playerId,
        seat: e.seat,
        cashOut: e.cashOut,
      })),
      ...refundsFromState(this.state),
    ];
    this.state = { ...this.state, seats: this.state.seats.map(() => null), hand: null };
    this.expectedChips = 0;

    for (const refund of refunds) {
      if (touchStore) await this.cashOut(refund);
      else
        this.callHook('playerLeft', (h) => h.playerLeft?.(this, refund.playerId, refund.cashOut));
    }
    if (events.length > 0) {
      this.currentSeq++;
      this.broadcast(events);
    }
    const closed = this.closedMessage(reason);
    for (const [playerId, listener] of [...this.listeners]) this.send(playerId, listener, closed);
    this.listeners.clear();
    this.callHook('closed', (h) => h.closed?.(this));
  }

  private applyInPlace(action: HoldemAction, events: HoldemEvent[]): void {
    const result = this.apply(action);
    if (!result.ok) throw new Error(`${action.type} rejected with ${result.error.code}`);
    this.state = result.state;
    events.push(...result.events);
  }

  private buildUpdate(playerId: string, events: readonly HoldemEvent[]): TableUpdate {
    return {
      tableId: this.id,
      seq: this.currentSeq,
      events,
      view: viewFor(this.state, playerId),
      turn: this.turn(),
    };
  }

  private turn(): TableUpdate['turn'] {
    const hand = this.state.hand;
    const clock = this.turnClock;
    if (!isHandInProgress(hand) || hand.toAct === null || !clock) return null;
    return { seat: hand.toAct, endsInMs: Math.max(0, clock.deadline - this.deps.scheduler.now()) };
  }

  private broadcast(events: readonly HoldemEvent[]): void {
    for (const [playerId, listener] of [...this.listeners]) {
      this.send(playerId, listener, { type: 'update', update: this.buildUpdate(playerId, events) });
    }
  }

  private closedMessage(reason: TableClosedReason): TableMessage {
    return { type: 'closed', closed: { tableId: this.id, reason } };
  }

  private degradedMessage(degraded: boolean): TableMessage {
    return { type: 'degraded', degraded: { tableId: this.id, degraded } };
  }

  private broadcastMessage(message: TableMessage): void {
    for (const [playerId, listener] of [...this.listeners]) this.send(playerId, listener, message);
  }

  /** A failing listener is logged and never affects the table or the other listeners. */
  private send(playerId: string, listener: TableListener, message: TableMessage): void {
    try {
      listener(message);
    } catch (error) {
      this.logError(`listener of ${playerId} failed`, error);
    }
  }

  private callHook(name: keyof TableHooks, call: (hooks: Partial<TableHooks>) => void): void {
    try {
      call(this.deps.hooks ?? {});
    } catch (error) {
      this.logError(`hook ${name} failed`, error);
    }
  }

  /**
   * Stands a seat up in the store (crediting the wallet or the house) and calls `hooks.playerLeft`
   * (close path). A failure is logged and never interrupts the close.
   */
  private async cashOut(left: Left): Promise<void> {
    await this.standUpQuietly({ tableId: this.id, ...left });
    this.callHook('playerLeft', (h) => h.playerLeft?.(this, left.playerId, left.cashOut));
  }

  private async standUpQuietly(a: Parameters<TableStore['standUp']>[0]): Promise<void> {
    try {
      await this.deps.store.standUp(a);
    } catch (error) {
      this.logError(`could not stand up a seat with ${a.cashOut} chips`, error);
    }
  }

  private async saveQuietly(record: HandRecord | null): Promise<void> {
    if (!record) return;
    try {
      await this.deps.store.persistHand(record);
    } catch (error) {
      this.logError('could not save the voided hand', error);
    }
  }

  /** Logs the error's name, message and stack only: never the table state or cards. */
  private logError(context: string, error: unknown): void {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'non-Error thrown';
    this.deps.logger.error(
      `Table ${this.id}: ${context}: ${detail}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
