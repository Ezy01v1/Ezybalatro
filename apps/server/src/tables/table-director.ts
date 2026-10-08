import { BOT_PERSONALITY_IDS, nextInt, type Rng } from '@naipes/engine';
import type { Ack, SocketError } from '@naipes/shared';
import { BOT_NAMES } from '../bots/bot-names';
import { BotPlayer } from '../bots/bot-player';
import { socketError } from './errors';
import type { DeckSource, Scheduler, TableLogger, Timer } from './ports';
import { isBotId, TableRuntime, type TableHooks } from './table-runtime';
import type { TableSettings } from './table-settings';
import type { TableStore } from './table-store';

export interface DirectorDeps {
  settings: TableSettings;
  scheduler: Scheduler;
  deckSource: DeckSource;
  store: TableStore;
  logger: TableLogger;
  /** Bot names and personalities. */
  botRng: Rng;
  newTableId: () => string;
}

export type QuickSeatResult = Ack<{ tableId: string; seat: number }>;

interface TableEntry {
  readonly runtime: TableRuntime;
  readonly bots: Map<string, BotPlayer>;
  /** Pending `close('empty')` while nobody human is seated. */
  emptyTimer: Timer | null;
  /** The running rebalance loop, if any (one per table at a time). */
  rebalancing: Promise<void> | null;
  /** A rebalance was requested while one was running: run once more. */
  rebalanceAgain: boolean;
  /** `store.openTable`: nobody sits before it resolves; if it fails the table is dropped. */
  readonly opened: Promise<void>;
}

const fail = (error: SocketError): { ok: false; error: SocketError } => ({ ok: false, error });

/**
 * The user's seat at `table`, or null if they are not there or only `leaving` (freed at settle, or
 * once a degraded table saves its hand).
 */
function activeSeat(table: TableRuntime, userId: string): number | null {
  const seat = table.seatOf(userId);
  if (seat === null || table.isLeavePending(userId)) return null;
  return table.snapshot('').view.seats[seat]?.status === 'leaving' ? null : seat;
}

/**
 * Owns every in-memory table (spec §5.4, §5.5): quick seat for humans, bot filling and seat freeing,
 * closing tables left without humans, and shutdown.
 *
 * The director never touches a table's state directly: it reads the runtime's queries and sends
 * ordinary commands through the runtime's queue, like any client.
 */
export class TableDirector {
  private readonly entries = new Map<string, TableEntry>();
  /** userId → tableId of the table where the director seated them. */
  private readonly seats = new Map<string, string>();
  /** In-flight quick seats: concurrent calls of the same user share one. */
  private readonly pending = new Map<string, Promise<QuickSeatResult>>();
  private shuttingDown = false;

  constructor(private readonly deps: DirectorDeps) {}

  // ------------------------------------------------------------ queries

  tableOf(userId: string): TableRuntime | null {
    const tableId = this.seats.get(userId);
    return tableId === undefined ? null : this.get(tableId);
  }

  get(tableId: string): TableRuntime | null {
    return this.entries.get(tableId)?.runtime ?? null;
  }

  tables(): readonly TableRuntime[] {
    return [...this.entries.values()].map((e) => e.runtime);
  }

  // ------------------------------------------------------------ commands

  /**
   * Seats the user at the table with the most humans that has a free seat (ties: the oldest), or at a
   * new table. Idempotent for a user who is already seated. On error no table is left behind.
   */
  quickSeat(userId: string, buyIn?: number): Promise<QuickSeatResult> {
    const inFlight = this.pending.get(userId);
    if (inFlight) return inFlight;
    const attempt = this.seat(userId, buyIn)
      .catch((error: unknown) => {
        this.logError('quick seat failed', error);
        return fail(socketError('INTERNAL', 'Internal error'));
      })
      .finally(() => this.pending.delete(userId));
    this.pending.set(userId, attempt);
    return attempt;
  }

  /** No new hand starts anywhere; then every table is closed (hands voided, everybody cashed out). */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const tables = this.tables();
    for (const table of tables) table.stopDealing();
    await Promise.all(tables.map((table) => table.close('shutdown')));
  }

  // ------------------------------------------------------------ quick seat

  private async seat(userId: string, buyIn: number | undefined): Promise<QuickSeatResult> {
    const current = this.tableOf(userId);
    const currentSeat = current ? activeSeat(current, userId) : null;
    if (current && currentSeat !== null)
      return { ok: true, tableId: current.id, seat: currentSeat };
    // Not seated, or `leaving` (left mid-hand, freed at settle): seat them anew. The old table's
    // `playerLeft` only clears the mapping while it still points at that table.
    this.seats.delete(userId);
    if (this.shuttingDown) return fail(socketError('TABLE_CLOSED', 'The server is shutting down'));

    const amount = await this.buyInFor(userId, buyIn);
    if (!amount.ok) return amount;

    for (const table of this.candidates(userId)) {
      // A table still opening in the store may fail (and be dropped) meanwhile: skip it.
      const entry = this.entries.get(table.id);
      if (!entry) continue;
      try {
        await entry.opened;
      } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'non-Error thrown';
        this.deps.logger.warn(`Table ${table.id} failed to open; skipped for quick seat: ${detail}`);
        continue;
      }
      if (this.entries.get(table.id) !== entry) continue;
      const result = await table.sit(userId, amount.buyIn);
      if (result.ok) return this.seated(userId, table, result.seat);
      if (result.error.code !== 'TABLE_FULL' && result.error.code !== 'TABLE_CLOSED') return result;
    }

    if (this.shuttingDown) return fail(socketError('TABLE_CLOSED', 'The server is shutting down'));
    const table = this.createTable();
    await this.entries.get(table.id)?.opened;
    const result = await table.sit(userId, amount.buyIn);
    if (result.ok) return this.seated(userId, table, result.seat);
    // Never leave an empty table behind (unless another user's sit got there first).
    if (!(await table.closeIfEmpty())) this.checkEmpty(this.entries.get(table.id));
    return result;
  }

  private async buyInFor(
    userId: string,
    buyIn: number | undefined,
  ): Promise<{ ok: true; buyIn: number } | { ok: false; error: SocketError }> {
    const { minBuyIn, maxBuyIn } = this.deps.settings.config;
    if (
      buyIn !== undefined &&
      (!Number.isSafeInteger(buyIn) || buyIn < minBuyIn || buyIn > maxBuyIn)
    ) {
      return fail(
        socketError(
          'INVALID_AMOUNT',
          `Buy-in must be an integer between ${minBuyIn} and ${maxBuyIn}`,
        ),
      );
    }
    const balance = await this.deps.store.balance(userId);
    const amount = buyIn ?? Math.min(maxBuyIn, balance);
    if (amount < minBuyIn || amount > balance) {
      return fail(socketError('INSUFFICIENT_CHIPS', 'Not enough chips for the buy-in'));
    }
    return { ok: true, buyIn: amount };
  }

  /**
   * Open tables with a free seat where the user is not listed (a `leaving` seat still is), most humans
   * first, then the oldest.
   */
  private candidates(userId: string): TableRuntime[] {
    return this.tables()
      .filter(
        (t) =>
          t.status !== 'closed' &&
          !t.closing &&
          !t.degraded &&
          t.hasFreeSeat() &&
          t.seatOf(userId) === null,
      )
      .sort((a, b) => b.humanCount() - a.humanCount() || a.createdAt - b.createdAt);
  }

  private async seated(
    userId: string,
    table: TableRuntime,
    seat: number,
  ): Promise<QuickSeatResult> {
    this.seats.set(userId, table.id);
    const entry = this.entries.get(table.id);
    if (entry) await this.rebalance(entry);
    return { ok: true, tableId: table.id, seat };
  }

  /**
   * Registers the table in memory right away (so concurrent quick seats find it) and in the store;
   * seats wait for `opened`.
   */
  private createTable(): TableRuntime {
    const { settings, scheduler, deckSource, store, logger } = this.deps;
    const id = this.deps.newTableId();
    const hooks: TableHooks = {
      afterHand: () => void this.rebalance(entry),
      playerLeft: (table, playerId) => this.onPlayerLeft(entry, table, playerId),
      changed: () => this.checkEmpty(entry),
      closed: () => this.onClosed(entry),
    };
    const runtime = new TableRuntime({
      id,
      config: settings.config,
      timings: settings.timings,
      scheduler,
      deckSource,
      store,
      logger,
      hooks,
    });
    const entry: TableEntry = {
      runtime,
      bots: new Map(),
      emptyTimer: null,
      rebalancing: null,
      rebalanceAgain: false,
      opened: store.openTable(id, settings.config),
    };
    entry.opened.catch(() => {
      if (this.entries.get(id) === entry) this.entries.delete(id);
    });
    this.entries.set(id, entry);
    return runtime;
  }

  // ------------------------------------------------------------ hooks

  private onPlayerLeft(entry: TableEntry, table: TableRuntime, playerId: string): void {
    if (isBotId(playerId)) {
      entry.bots.get(playerId)?.stop();
      entry.bots.delete(playerId);
    } else if (this.seats.get(playerId) === table.id) {
      this.seats.delete(playerId);
    }
    if (table.status !== 'closed' && !table.isHandInProgress()) void this.rebalance(entry);
  }

  /** With no human seated the table closes after `emptyTableCloseMs`; a human sitting cancels it. */
  private checkEmpty(entry: TableEntry | undefined): void {
    if (!entry) return;
    const table = entry.runtime;
    if (table.status !== 'closed' && table.humanCount() === 0) {
      entry.emptyTimer ??= this.deps.scheduler.schedule(
        this.deps.settings.emptyTableCloseMs,
        () => {
          entry.emptyTimer = null;
          // Inside the queue: a human sit queued before it keeps the table open.
          table
            .closeIfEmpty()
            .then((closed) => {
              if (!closed) this.checkEmpty(entry);
            })
            .catch((error: unknown) => this.logError(`table ${table.id}: close failed`, error));
        },
      );
    } else {
      entry.emptyTimer?.cancel();
      entry.emptyTimer = null;
    }
  }

  private onClosed(entry: TableEntry): void {
    const table = entry.runtime;
    entry.emptyTimer?.cancel();
    entry.emptyTimer = null;
    for (const bot of entry.bots.values()) bot.stop();
    entry.bots.clear();
    for (const [userId, tableId] of [...this.seats]) {
      if (tableId === table.id) this.seats.delete(userId);
    }
    if (this.entries.get(table.id) === entry) this.entries.delete(table.id);
    this.deps.store
      .closeTable(table.id)
      .catch((error: unknown) => this.logError(`table ${table.id}: closeTable failed`, error));
  }

  // ------------------------------------------------------------ bots

  /**
   * Runs the rebalance of a table, one at a time: a request while one is running makes it run once
   * more instead of running two side by side (which could over-fill the table).
   */
  private rebalance(entry: TableEntry): Promise<void> {
    if (entry.rebalancing) {
      entry.rebalanceAgain = true;
      return entry.rebalancing;
    }
    const run = async (): Promise<void> => {
      try {
        do {
          entry.rebalanceAgain = false;
          await this.rebalanceOnce(entry);
        } while (entry.rebalanceAgain);
      } catch (error) {
        this.logError(`table ${entry.runtime.id}: rebalance failed`, error);
      } finally {
        entry.rebalancing = null;
      }
    };
    entry.rebalancing = run();
    return entry.rebalancing;
  }

  /**
   * Only between hands (ruling R4): busted or sitting-out bots leave; a full table with more players
   * than `botFillTarget` frees a seat by sending one bot away; then bots sit up to `botFillTarget`.
   * Bots never push the table past `botFillTarget`, so freeing a seat and filling never undo each other.
   */
  private async rebalanceOnce(entry: TableEntry): Promise<void> {
    const table = entry.runtime;
    const idle = () => table.status === 'open' && !table.closing && !table.degraded;
    if (!idle()) return;

    for (const seat of table.snapshot('').view.seats) {
      if (!seat || !isBotId(seat.playerId)) continue;
      if (seat.stack > 0 && seat.status !== 'sitting_out') continue;
      if (!idle()) return;
      await table.leave(seat.playerId);
    }

    const { botFillTarget, botDelayMs, config } = this.deps.settings;
    if (!table.hasFreeSeat() && table.playerCount() > botFillTarget) {
      const bot = table.playerIds().find(isBotId);
      if (bot !== undefined) {
        if (!idle()) return;
        await table.leave(bot);
      }
    }

    const { botRng, scheduler } = this.deps;
    while (idle() && table.hasFreeSeat() && table.playerCount() < botFillTarget) {
      const name = this.freeBotName(entry);
      if (name === null) return;
      const botId = `bot:${name}`;
      const personality = BOT_PERSONALITY_IDS[nextInt(botRng, BOT_PERSONALITY_IDS.length)]!;
      const result = await table.sit(botId, config.maxBuyIn);
      if (!result.ok) {
        if (result.error.code !== 'TABLE_FULL' && result.error.code !== 'TABLE_CLOSED') {
          this.deps.logger.warn(`Table ${table.id}: a bot could not sit (${result.error.code})`);
        }
        return;
      }
      const player = new BotPlayer(table, botId, personality, {
        scheduler,
        rng: botRng,
        delayMs: botDelayMs,
        logger: this.deps.logger,
      });
      entry.bots.set(botId, player);
      player.start();
    }
  }

  private freeBotName(entry: TableEntry): string | null {
    const used = new Set([...entry.runtime.playerIds(), ...entry.bots.keys()]);
    const free = BOT_NAMES.filter((name) => !used.has(`bot:${name}`));
    return free.length === 0 ? null : free[nextInt(this.deps.botRng, free.length)]!;
  }

  private logError(context: string, error: unknown): void {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'non-Error thrown';
    this.deps.logger.error(
      `TableDirector: ${context}: ${detail}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
