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
  TableUpdate,
} from '@naipes/shared';
import { socketError, toSocketError } from './errors';
import { PlayerTimers, type PlayerTimerToken } from './player-timers';
import type { DeckSource, Scheduler, TableLogger, Timer, WalletPort } from './ports';
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
  { type: 'update'; update: TableUpdate } | { type: 'closed'; closed: TableClosed };
export type TableListener = (message: TableMessage) => void;
export type TableResult<T extends object = object> = Ack<T>;
export type TableStatus = 'open' | 'running' | 'closed';

export interface TableHooks {
  /** A hand settled or was voided. */
  afterHand(table: TableRuntime): void;
  /** A player's seat was freed; `cashOut` was already credited to the wallet or the house. */
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
  wallet: WalletPort;
  house: WalletPort;
  logger: TableLogger;
  hooks?: Partial<TableHooks>;
}

type Applied = { ok: true; events: readonly HoldemEvent[] } | { ok: false; error: SocketError };

const fail = (error: SocketError): { ok: false; error: SocketError } => ({ ok: false, error });
const internalError = () => fail(socketError('INTERNAL', 'Internal error'));
const tableClosed = () => fail(socketError('TABLE_CLOSED', 'The table is closed'));
const OK = { ok: true } as const;

type TurnClock = { readonly handNumber: number; readonly seat: number; readonly deadline: number };

/**
 * Authoritative, in-memory runtime of one Hold'em table (spec §3.3, §5.1, §5.2, §6.2).
 *
 * Every public command runs through a FIFO promise queue, one at a time, including its wallet awaits.
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
      const seat = this.state.seats.findIndex((s) => s === null);
      if (seat === -1) return fail(socketError('TABLE_FULL', 'The table is full'));
      const source = this.sourceOf(playerId);
      if (!(await source.debit(playerId, buyIn))) {
        return fail(socketError('INSUFFICIENT_CHIPS', 'Not enough chips for the buy-in'));
      }
      let result: HoldemResult;
      try {
        result = this.apply({ type: 'sit', playerId, seat, buyIn, postBlindsToEnter });
      } catch (error) {
        await source.credit(playerId, buyIn);
        throw error;
      }
      if (!result.ok) {
        await source.credit(playerId, buyIn);
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
      const result = await this.applyAndCommit({ type: 'leave', playerId });
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
  protected apply(action: HoldemAction): HoldemResult {
    return holdemReducer(this.state, action);
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

  private async applyAndCommit(action: HoldemAction): Promise<Applied> {
    const result = this.apply(action);
    if (!result.ok) return fail(toSocketError(result.error));
    if (!(await this.commit(result))) return internalError();
    return { ok: true, events: result.events };
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
    this.updateTurnClock(result.events);
    this.syncPlayerTimers();
    const left = playerLeftEvents(result.events);
    for (const e of left) {
      // The chips left the table whether or not the credit succeeds.
      this.expectedChips -= e.cashOut;
      await this.cashOut(e.playerId, e.cashOut);
    }
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
    if (result.events.some((e) => e.type === 'handSettled' || e.type === 'handVoided')) {
      this.callHook('afterHand', (h) => h.afterHand?.(this));
    }
    this.callHook('changed', (h) => h.changed?.(this));
    this.scheduleNextHand();
    return true;
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
    const result = await this.applyAndCommit({ type: 'leave', playerId });
    if (!result.ok) {
      this.deps.logger.warn(`Table ${this.id}: sitting-out leave rejected (${result.error.code})`);
    }
    return OK;
  }

  private scheduleNextHand(): void {
    if (this.closing || this.startTimer || this.isHandInProgress()) return;
    if (nextHandPositions(this.state) === null) return;
    this.startTimer = this.deps.scheduler.schedule(this.deps.timings.betweenHandsMs, () => {
      void this.enqueue('startHand', () => this.startHand());
    });
  }

  private async startHand(): Promise<TableResult> {
    this.startTimer = null;
    if (this.closing || this.isHandInProgress() || nextHandPositions(this.state) === null) {
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
   * Closes the table. Except for `error`, the hand in progress is voided and everybody leaves through
   * the reducer (and gets a last update). With `error` nothing goes through the reducer: each player
   * gets the stack they had at the start of the hand in progress, or their current stack.
   */
  private async shutdown(reason: TableClosedReason): Promise<void> {
    if (this.closedReason) return;
    this.closedReason = reason;
    this.startTimer?.cancel();
    this.startTimer = null;
    this.stopTurnClock();
    this.playerTimers.cancelAll();

    const events: HoldemEvent[] = [];
    if (reason !== 'error') {
      try {
        if (this.isHandInProgress()) this.applyInPlace({ type: 'voidHand' }, events);
        for (const playerId of this.playerIds())
          this.applyInPlace({ type: 'leave', playerId }, events);
      } catch (error) {
        this.logError('could not cash out through the reducer', error);
      }
    }
    const refunds = [
      ...playerLeftEvents(events).map((e) => ({ playerId: e.playerId, amount: e.cashOut })),
      ...refundsFromState(this.state),
    ];
    this.state = { ...this.state, seats: this.state.seats.map(() => null), hand: null };
    this.expectedChips = 0;

    for (const { playerId, amount } of refunds) await this.cashOut(playerId, amount);
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
   * Credits a freed seat's chips to the wallet or the house and calls `hooks.playerLeft`. A failed
   * credit is logged and never interrupts the command (the rest of the commit or close still runs).
   */
  private async cashOut(playerId: string, amount: number): Promise<void> {
    if (amount > 0) {
      try {
        await this.sourceOf(playerId).credit(playerId, amount);
      } catch (error) {
        this.logError(`could not cash out ${amount} chips`, error);
      }
    }
    this.callHook('playerLeft', (h) => h.playerLeft?.(this, playerId, amount));
  }

  private sourceOf(playerId: string): WalletPort {
    return isBotId(playerId) ? this.deps.house : this.deps.wallet;
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
