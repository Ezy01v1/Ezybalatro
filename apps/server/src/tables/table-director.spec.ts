import {
  createSeededRng,
  createStandardDeck,
  nextInt,
  shuffleDeck,
  type HoldemEvent,
  type LegalActions,
  type Rng,
} from '@naipes/engine';
import type { PlayerAction, TableClosed } from '@naipes/shared';
import { InMemoryTableStore } from './in-memory-table-store';
import { TableDirector, type DirectorDeps } from './table-director';
import { isBotId, type TableRuntime } from './table-runtime';
import type { TableSettings } from './table-settings';
import { FakeScheduler } from './testing/fake-scheduler';
import {
  checkOrCall,
  TEST_CONFIG,
  TEST_TIMINGS,
  TEST_WALLET_INITIAL,
  type TestLogger,
} from './testing/table-harness';

const SETTINGS: TableSettings = {
  config: TEST_CONFIG,
  timings: TEST_TIMINGS,
  botFillTarget: 4,
  emptyTableCloseMs: 60_000,
  botDelayMs: { min: 500, max: 1500 },
  devWalletInitial: TEST_WALLET_INITIAL,
  socketRateLimitPerSec: 20,
};

function makeDirector(overrides: Partial<TableSettings> = {}, deps: Partial<DirectorDeps> = {}) {
  const settings: TableSettings = { ...SETTINGS, ...overrides };
  const scheduler = new FakeScheduler();
  const store =
    (deps.store as InMemoryTableStore | undefined) ??
    new InMemoryTableStore({ initial: settings.devWalletInitial });
  const logger: TestLogger = { warn: jest.fn(), error: jest.fn() };
  const deckRng = createSeededRng('director-deck');
  let tables = 0;
  const director = new TableDirector({
    settings,
    scheduler,
    deckSource: { nextDeck: () => shuffleDeck(deckRng, createStandardDeck()) },
    logger,
    botRng: createSeededRng('director-bots'),
    newTableId: () => `t${++tables}`,
    ...deps,
    store,
  });
  // `wallet` and `house` read the same store (kept apart for readability).
  return { director, scheduler, store, wallet: store, house: store, logger, settings };
}

type Choose = (legal: LegalActions) => PlayerAction;
const callDown: Choose = (legal) => checkOrCall(legal, '');

/** A human client: acts with `choose` on every update that has legal actions. */
function drive(table: TableRuntime, userId: string, choose: Choose = callDown): () => void {
  return table.subscribe(userId, (m) => {
    if (m.type !== 'update' || !m.update.view.legal) return;
    void table.act(userId, m.update.seq, choose(m.update.view.legal));
  });
}

/** Records every event and the `closed` message seen by a spectator. */
function observe(table: TableRuntime) {
  const events: HoldemEvent[] = [];
  const closed: TableClosed[] = [];
  table.subscribe('observer', (m) => {
    if (m.type === 'update') events.push(...m.update.events);
    else if (m.type === 'closed') closed.push(m.closed);
  });
  return { events, closed };
}

const botsAt = (table: TableRuntime) => table.playerIds().filter(isBotId);

async function seat(director: TableDirector, userId: string, buyIn?: number) {
  const result = await director.quickSeat(userId, buyIn);
  if (!result.ok) throw new Error(`quickSeat ${userId} failed: ${result.error.code}`);
  return result;
}

describe('TableDirector', () => {
  it('creates a table and fills it with bots up to botFillTarget', async () => {
    const { director, scheduler, wallet, house, logger } = makeDirector();

    const result = await director.quickSeat('alice');
    await scheduler.flush();

    expect(result).toEqual({ ok: true, tableId: 't1', seat: 0 });
    const table = director.get('t1')!;
    expect(director.tables()).toEqual([table]);
    expect(director.tableOf('alice')).toBe(table);
    expect(table.playerCount()).toBe(4);
    expect(table.humanCount()).toBe(1);
    const bots = botsAt(table);
    expect(bots).toHaveLength(3);
    expect(new Set(bots).size).toBe(3);
    for (const id of bots) {
      expect(id).toMatch(/^bot:[A-Za-z]+$/);
      expect(table.stackOf(id)).toBe(TEST_CONFIG.maxBuyIn);
    }
    // No buy-in given: min(maxBuyIn, balance).
    expect(table.stackOf('alice')).toBe(TEST_CONFIG.maxBuyIn);
    expect(await wallet.balance('alice')).toBe(TEST_WALLET_INITIAL - TEST_CONFIG.maxBuyIn);
    expect(house.houseOutstanding()).toBe(3 * TEST_CONFIG.maxBuyIn);

    // The bots play: a hand starts and is acted on without any human input but alice's.
    drive(table, 'alice');
    await scheduler.advance(30_000);
    expect(table.snapshot('').view.handNumber).toBeGreaterThan(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('quickSeat prefers the table with the most humans', async () => {
    // No bots: tables hold humans only; time never moves, so no hand starts.
    const { director } = makeDirector({ botFillTarget: 1 });
    for (let i = 1; i <= 6; i++) await seat(director, `u${i}`);
    expect((await seat(director, 'u7')).tableId).toBe('t2'); // t1 is full
    for (const u of ['u8', 'u9', 'u10']) expect((await seat(director, u)).tableId).toBe('t2');

    const t1 = director.get('t1')!;
    for (const u of ['u1', 'u2', 'u3', 'u4']) await t1.leave(u);
    expect(director.tableOf('u1')).toBeNull();
    // t1: 2 humans (older), t2: 4 humans.
    expect((await seat(director, 'u11')).tableId).toBe('t2');

    const t2 = director.get('t2')!;
    for (const u of ['u7', 'u8', 'u9']) await t2.leave(u);
    // Tie (2 and 2): the oldest table wins.
    expect(t1.humanCount()).toBe(t2.humanCount());
    expect((await seat(director, 'u12')).tableId).toBe('t1');
  });

  it('quickSeat is idempotent for a seated user', async () => {
    const { director, wallet } = makeDirector();
    const first = await seat(director, 'alice', 1000);
    const second = await seat(director, 'alice', 1500);

    expect(second).toEqual(first);
    expect(await wallet.balance('alice')).toBe(TEST_WALLET_INITIAL - 1000);
    expect(director.tables()).toHaveLength(1);
  });

  it('a user leaving mid-hand who quick seats again gets a new seat elsewhere', async () => {
    const { director, scheduler, wallet, logger } = makeDirector();
    await seat(director, 'alice');
    const t1 = director.get('t1')!;
    const { events } = observe(t1);
    await scheduler.advance(TEST_TIMINGS.betweenHandsMs);
    expect(t1.isHandInProgress()).toBe(true);

    expect(await t1.leave('alice')).toEqual({ ok: true, cashOut: null });
    expect(t1.snapshot('').view.seats[t1.seatOf('alice')!]!.status).toBe('leaving');

    // Back in the lobby before the hand ends: t1 still lists alice (and has free seats).
    const again = await director.quickSeat('alice');
    expect(again).toEqual({ ok: true, tableId: 't2', seat: 0 });
    const t2 = director.get('t2')!;
    expect(director.tableOf('alice')).toBe(t2);
    expect(await wallet.balance('alice')).toBe(TEST_WALLET_INITIAL - 2 * TEST_CONFIG.maxBuyIn);

    while (t1.isHandInProgress()) await scheduler.advance(250);
    const left = events.find((e) => e.type === 'playerLeft' && e.playerId === 'alice');
    expect(left).toBeDefined();
    const cashOut = left!.type === 'playerLeft' ? left!.cashOut : 0;
    expect(t1.seatOf('alice')).toBeNull();
    // The old table's leave did not clear the new mapping.
    expect(director.tableOf('alice')).toBe(t2);
    expect(t2.seatOf('alice')).toBe(0);
    expect(await wallet.balance('alice')).toBe(
      TEST_WALLET_INITIAL - 2 * TEST_CONFIG.maxBuyIn + cashOut,
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('two concurrent quickSeat calls seat once and debit once', async () => {
    const { director, wallet } = makeDirector();
    const [a, b] = await Promise.all([director.quickSeat('alice'), director.quickSeat('alice')]);

    expect(a).toEqual({ ok: true, tableId: 't1', seat: 0 });
    expect(b).toEqual(a);
    expect(director.tables()).toHaveLength(1);
    expect(director.get('t1')!.humanCount()).toBe(1);
    expect(await wallet.balance('alice')).toBe(TEST_WALLET_INITIAL - TEST_CONFIG.maxBuyIn);

    // Settled: a later call is a fresh (idempotent) lookup.
    expect(await director.quickSeat('alice')).toEqual(a);
  });

  it('concurrent quick seats of different users do not over-fill the table with bots', async () => {
    const { director, scheduler, house } = makeDirector();
    const [a, b] = await Promise.all([director.quickSeat('alice'), director.quickSeat('bob')]);
    await scheduler.flush();

    expect(a).toEqual({ ok: true, tableId: 't1', seat: 0 });
    expect(b).toEqual({ ok: true, tableId: 't1', seat: 1 });
    const table = director.get('t1')!;
    expect(table.playerCount()).toBe(SETTINGS.botFillTarget);
    expect(botsAt(table)).toHaveLength(2);
    expect(house.houseOutstanding()).toBe(2 * TEST_CONFIG.maxBuyIn);
  });

  it('INSUFFICIENT_CHIPS without creating a table when the wallet is short', async () => {
    const { director, wallet } = makeDirector({ devWalletInitial: 300 });

    const result = await director.quickSeat('alice');

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INSUFFICIENT_CHIPS' }),
    });
    expect(director.tables()).toHaveLength(0);
    expect(director.tableOf('alice')).toBeNull();
    expect(await wallet.balance('alice')).toBe(300);
  });

  it('validates an explicit buy-in before touching any table', async () => {
    const { director, wallet } = makeDirector({ devWalletInitial: 1000 });

    for (const buyIn of [399, 2001, 1.5, 0, -400]) {
      expect(await director.quickSeat('alice', buyIn)).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'INVALID_AMOUNT' }),
      });
    }
    expect(await director.quickSeat('alice', 1500)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INSUFFICIENT_CHIPS' }),
    });
    expect(director.tables()).toHaveLength(0);

    // Without a buy-in, the whole (short) balance is used.
    const seated = await seat(director, 'alice');
    expect(director.get(seated.tableId)!.stackOf('alice')).toBe(1000);
    expect(await wallet.balance('alice')).toBe(0);
  });

  it('closes the new table when the human cannot sit on it', async () => {
    // The balance looks fine but the debit fails (e.g. a concurrent spend).
    class ShortStore extends InMemoryTableStore {
      override async sitDown() {
        return 'insufficient' as const;
      }
    }
    const { director, house } = makeDirector(
      {},
      { store: new ShortStore({ initial: TEST_WALLET_INITIAL }) },
    );

    const result = await director.quickSeat('alice');

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INSUFFICIENT_CHIPS' }),
    });
    expect(director.tables()).toHaveLength(0);
    expect(director.get('t1')).toBeNull();
    expect(house.houseOutstanding()).toBe(0);
  });

  it('opens each table in the store before seating and closes it there', async () => {
    const { director, store, scheduler } = makeDirector({ emptyTableCloseMs: 1000 });
    await seat(director, 'alice');
    expect(store.tableStatus('t1')).toBe('open');
    await director.get('t1')!.leave('alice');
    await scheduler.advance(1000);
    await scheduler.flush();
    expect(director.tables()).toHaveLength(0);
    expect(store.tableStatus('t1')).toBe('closed');
    expect(store.seatRows('t1')).toEqual([]);
  });

  it('a candidate table whose openTable fails is skipped, not joined', async () => {
    let rejectOpen!: (e: Error) => void;
    class GatedStore extends InMemoryTableStore {
      override openTable(id: string, config: Parameters<InMemoryTableStore['openTable']>[1]) {
        if (id !== 't1') return super.openTable(id, config);
        return new Promise<void>((_, reject) => (rejectOpen = reject));
      }
    }
    const store = new GatedStore({ initial: TEST_WALLET_INITIAL });
    const { director } = makeDirector({}, { store });
    const alice = director.quickSeat('alice');
    await Promise.resolve();
    await new Promise<void>((r) => setImmediate(r));
    const bob = director.quickSeat('bob'); // t1 is a candidate, still opening
    await new Promise<void>((r) => setImmediate(r));
    rejectOpen(new Error('db down'));
    expect(await alice).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INTERNAL' }),
    });
    expect(await bob).toEqual({ ok: true, tableId: 't2', seat: 0 });
    expect(director.get('t1')).toBeNull();
    expect(store.seatRows('t1')).toEqual([]);
  });

  it('a failing openTable is INTERNAL and leaves no table behind', async () => {
    const store = new InMemoryTableStore({ initial: TEST_WALLET_INITIAL });
    store.failNext('openTable');
    const { director } = makeDirector({}, { store });
    expect(await director.quickSeat('alice')).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INTERNAL' }),
    });
    expect(director.tables()).toHaveLength(0);
    expect(await store.balance('alice')).toBe(TEST_WALLET_INITIAL);
    expect(await director.quickSeat('alice')).toEqual({ ok: true, tableId: 't2', seat: 0 });
  });

  it('a degraded table takes no quick seat', async () => {
    const { director, store, scheduler } = makeDirector();
    await seat(director, 'alice');
    const table = director.get('t1')!;
    drive(table, 'alice');
    store.failNext('persistHand', 1000);
    await scheduler.advance(TEST_TIMINGS.betweenHandsMs);
    for (let i = 0; i < 200 && !table.degraded; i++) await scheduler.advance(1000);
    expect(table.degraded).toBe(true);
    const bob = await director.quickSeat('bob');
    expect(bob).toEqual({ ok: true, tableId: 't2', seat: 0 });
  });

  it('a failing wallet becomes an INTERNAL error, not a rejection', async () => {
    let down = true;
    class DownStore extends InMemoryTableStore {
      override async balance(id: string) {
        if (down) throw new Error('wallet unavailable');
        return super.balance(id);
      }
    }
    const { director, logger } = makeDirector(
      {},
      { store: new DownStore({ initial: TEST_WALLET_INITIAL }) },
    );

    expect(await director.quickSeat('alice')).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INTERNAL' }),
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]![0]).toContain('wallet unavailable');
    expect(director.tables()).toHaveLength(0);

    down = false;
    expect(await director.quickSeat('alice')).toEqual({ ok: true, tableId: 't1', seat: 0 });
  });

  it('different users racing for the last seat: one sits, the other gets a new table', async () => {
    const { director, scheduler, wallet } = makeDirector();
    await seat(director, 'alice');
    await seat(director, 'bob');
    const t1 = director.get('t1')!;
    await scheduler.advance(TEST_TIMINGS.betweenHandsMs); // a hand is in progress: no rebalance
    expect(t1.isHandInProgress()).toBe(true);
    expect(t1.playerCount()).toBe(5);

    const [carol, dave] = await Promise.all([
      director.quickSeat('carol'),
      director.quickSeat('dave'),
    ]);

    expect(carol).toEqual({ ok: true, tableId: 't1', seat: expect.any(Number) });
    expect(dave).toEqual({ ok: true, tableId: 't2', seat: 0 });
    expect(t1.playerCount()).toBe(6);
    expect(director.get('t2')!.playerCount()).toBe(4);
    expect(await wallet.balance('carol')).toBe(TEST_WALLET_INITIAL - TEST_CONFIG.maxBuyIn);
    expect(await wallet.balance('dave')).toBe(TEST_WALLET_INITIAL - TEST_CONFIG.maxBuyIn);
  });

  it('quickSeat skips a table that stopped dealing', async () => {
    const { director } = makeDirector();
    await seat(director, 'alice');
    director.get('t1')!.stopDealing();

    expect(await director.quickSeat('bob')).toEqual({ ok: true, tableId: 't2', seat: 0 });
    // Already seated there: still idempotent.
    expect((await seat(director, 'alice')).tableId).toBe('t1');
  });

  it('a bot leaves to free a seat when the table is full', async () => {
    const { director, scheduler, logger } = makeDirector();
    await seat(director, 'alice');
    const table = director.get('t1')!;
    drive(table, 'alice');
    await scheduler.advance(TEST_TIMINGS.betweenHandsMs);
    expect(table.isHandInProgress()).toBe(true);
    const hand = table.snapshot('').view.handNumber;

    for (const u of ['bob', 'carol']) {
      await seat(director, u);
      drive(table, u);
    }
    // Full during the hand: no bot is sent away mid-hand (ruling R4).
    expect(table.playerCount()).toBe(6);
    expect(table.hasFreeSeat()).toBe(false);
    await scheduler.flush();
    expect(table.snapshot('').view.seats.every((s) => s?.status === 'seated')).toBe(true);

    while (table.isHandInProgress()) await scheduler.advance(250);
    expect(table.snapshot('').view.handNumber).toBe(hand);
    expect(table.playerCount()).toBe(5);
    expect(table.humanCount()).toBe(3);
    expect(botsAt(table)).toHaveLength(2);

    // 5 >= botFillTarget: no bot comes back in later hands.
    await scheduler.advance(30_000);
    expect(table.snapshot('').view.handNumber).toBeGreaterThan(hand);
    expect(table.playerCount()).toBe(5);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('busted bots are replaced', async () => {
    // Short stacks (10 big blinds) so a bot busts within a few dozen hands.
    const { director, scheduler, house, wallet, logger } = makeDirector({
      config: { ...TEST_CONFIG, minBuyIn: 200, maxBuyIn: 200 },
      botFillTarget: 2,
      devWalletInitial: 1_000_000,
    });
    // Alice shoves every hand; when she busts she leaves and sits again.
    const shove: Choose = (legal) => (legal.allIn !== null ? { type: 'allIn' } : callDown(legal));
    await seat(director, 'alice');
    const table = director.get('t1')!;
    const { events } = observe(table);
    drive(table, 'alice', shove);

    const bustedBot = () =>
      events.find(
        (e): e is Extract<HoldemEvent, { type: 'playerLeft' }> =>
          e.type === 'playerLeft' && isBotId(e.playerId) && e.cashOut === 0,
      );
    for (let step = 0; step < 2000 && !bustedBot(); step++) {
      await scheduler.advance(500);
      if (!table.isHandInProgress() && table.stackOf('alice') === 0) {
        await table.leave('alice');
        await seat(director, 'alice');
        drive(table, 'alice', shove);
      }
    }
    const busted = bustedBot();
    expect(busted).toBeDefined();
    await scheduler.flush();

    expect(table.seatOf(busted!.playerId)).toBeNull();
    const satAfter = events
      .slice(events.indexOf(busted!))
      .filter((e) => e.type === 'playerSat' && isBotId(e.playerId));
    expect(satAfter.length).toBeGreaterThanOrEqual(1);
    expect(table.playerCount()).toBeGreaterThanOrEqual(2);
    expect(wallet.total() + table.chipsOnTable() - house.houseOutstanding()).toBe(1_000_000);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('closes a table emptyTableCloseMs after the last human leaves, even mid-hand', async () => {
    // With these seeds a bots-only hand is in progress at 23 s.
    const emptyTableCloseMs = 23_000;
    const { director, scheduler, wallet, house, logger } = makeDirector({ emptyTableCloseMs });
    await seat(director, 'alice');
    const table = director.get('t1')!;
    const { events, closed } = observe(table);

    const left = await table.leave('alice');
    expect(left).toEqual({ ok: true, cashOut: TEST_CONFIG.maxBuyIn });
    await scheduler.flush();
    expect(director.tableOf('alice')).toBeNull();
    expect(table.humanCount()).toBe(0);
    expect(table.playerCount()).toBe(4); // a bot took alice's place

    // The bots keep playing among themselves until the deadline, which falls mid-hand.
    await scheduler.advance(emptyTableCloseMs - 1);
    expect(table.status).toBe('running');
    expect(director.tables()).toEqual([table]);

    await scheduler.advance(1);

    expect(table.status).toBe('closed');
    expect(events.some((e) => e.type === 'handVoided')).toBe(true);
    expect(closed).toEqual([{ tableId: 't1', reason: 'empty' }]);
    expect(director.tables()).toHaveLength(0);
    expect(director.get('t1')).toBeNull();
    expect(house.houseOutstanding()).toBe(0);
    expect(await wallet.balance('alice')).toBe(TEST_WALLET_INITIAL);
    expect(scheduler.pendingCount()).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a human sitting cancels the empty-table close', async () => {
    const emptyTableCloseMs = 20_000;
    const { director, scheduler } = makeDirector({ emptyTableCloseMs });
    await seat(director, 'alice');
    const table = director.get('t1')!;
    await table.leave('alice');
    await scheduler.advance(emptyTableCloseMs / 2);

    expect((await seat(director, 'bob')).tableId).toBe('t1');
    drive(table, 'bob');
    await scheduler.advance(emptyTableCloseMs);

    expect(table.status).not.toBe('closed');
    expect(director.tables()).toEqual([table]);
  });

  it('the empty-table close does not close onto a human whose sit is in flight', async () => {
    const emptyTableCloseMs = 20_000;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // Bob's sitDown is slow (e.g. a DB round trip): his sit is queued when the timer fires.
    class SlowStore extends InMemoryTableStore {
      override async sitDown(a: Parameters<InMemoryTableStore['sitDown']>[0]) {
        if (a.playerId === 'bob') await gate;
        return super.sitDown(a);
      }
    }
    const { director, scheduler, logger } = makeDirector(
      { emptyTableCloseMs },
      { store: new SlowStore({ initial: TEST_WALLET_INITIAL }) },
    );
    await seat(director, 'alice');
    const table = director.get('t1')!;
    await table.leave('alice');
    await scheduler.advance(emptyTableCloseMs - 1);

    const bob = director.quickSeat('bob');
    await scheduler.flush();
    await scheduler.advance(1); // the empty timer fires behind bob's sit
    release();

    expect(await bob).toEqual({ ok: true, tableId: 't1', seat: expect.any(Number) });
    await scheduler.flush();
    expect(table.status).not.toBe('closed');
    expect(director.tables()).toEqual([table]);
    expect(director.tableOf('bob')).toBe(table);

    // Bob leaving later re-arms the close.
    await table.leave('bob');
    await scheduler.advance(emptyTableCloseMs);
    expect(table.status).toBe('closed');
    expect(director.tables()).toHaveLength(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('shutdown voids hands and credits every human', async () => {
    const { director, scheduler, wallet, house, logger } = makeDirector();
    await seat(director, 'alice');
    await seat(director, 'bob', 500);
    const table = director.get('t1')!;
    const { events, closed } = observe(table);
    await scheduler.advance(TEST_TIMINGS.betweenHandsMs);
    expect(table.isHandInProgress()).toBe(true);

    await director.shutdown();

    expect(table.status).toBe('closed');
    expect(events.some((e) => e.type === 'handVoided')).toBe(true);
    expect(closed).toEqual([{ tableId: 't1', reason: 'shutdown' }]);
    expect(await wallet.balance('alice')).toBe(TEST_WALLET_INITIAL);
    expect(await wallet.balance('bob')).toBe(TEST_WALLET_INITIAL);
    expect(house.houseOutstanding()).toBe(0);
    expect(director.tables()).toHaveLength(0);
    expect(director.tableOf('alice')).toBeNull();
    expect(scheduler.pendingCount()).toBe(0);

    expect(await director.quickSeat('carol')).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'TABLE_CLOSED' }),
    });
    expect(director.tables()).toHaveLength(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('global chip conservation with humans joining, playing, disconnecting and leaving', async () => {
    const { director, scheduler, wallet, house, logger } = makeDirector({
      timings: {
        turnTimeoutMs: 10_000,
        disconnectGraceMs: 8_000,
        sittingOutMaxMs: 20_000,
        betweenHandsMs: 2_000,
      },
      emptyTableCloseMs: 20_000,
      botDelayMs: { min: 200, max: 1200 },
    });
    const users = new Set<string>();
    const unsubscribe = new Map<string, () => void>();
    const rng: Rng = createSeededRng('humans');
    const randomly: Choose = (legal) => {
      const roll = nextInt(rng, 100);
      if (roll < 10 && legal.allIn !== null) return { type: 'allIn' };
      if (roll < 25 && !legal.canCheck) return { type: 'fold' };
      if (roll < 35 && legal.raise) return { type: 'raise', to: legal.raise.min };
      if (roll < 35 && legal.bet) return { type: 'bet', amount: legal.bet.min };
      return callDown(legal);
    };

    const conserved = () => {
      const onTables = director.tables().reduce((sum, t) => sum + t.chipsOnTable(), 0);
      expect(wallet.total() + onTables - house.houseOutstanding()).toBe(
        SETTINGS.devWalletInitial * users.size,
      );
    };
    const join = async (u: string) => {
      users.add(u);
      await seat(director, u);
      unsubscribe.set(u, drive(director.tableOf(u)!, u, randomly));
    };
    const disconnect = (u: string) => {
      unsubscribe.get(u)?.();
      director.tableOf(u)?.disconnected(u);
    };
    const reconnect = (u: string) => {
      const table = director.tableOf(u);
      if (!table) return;
      table.reconnected(u);
      unsubscribe.set(u, drive(table, u, randomly));
    };
    const leave = async (u: string) => {
      await director.tableOf(u)?.leave(u);
    };

    const all =
      (f: (u: string) => unknown, ...us: string[]) =>
      async (): Promise<void> => {
        for (const u of us) await f(u);
      };
    const script = new Map<number, () => Promise<void>>([
      [0, all(join, 'u1')],
      [1_000, all(join, 'u2')],
      [5_000, all(join, 'u3', 'u4')],
      // 7 humans cannot fit at one table: a second table opens.
      [15_000, all(join, 'u5', 'u6', 'u7')],
      [20_000, all(disconnect, 'u2')],
      [25_000, all(reconnect, 'u2')],
      [30_000, all(disconnect, 'u3')], // never comes back: sits out, then leaves
      [40_000, all(leave, 'u1')],
      [45_000, all(join, 'u8')],
      [60_000, all(join, 'u1')],
      [80_000, all(leave, 'u4', 'u5')],
      [100_000, all(leave, 'u1', 'u2', 'u6', 'u7', 'u8')],
    ]);

    const stepMs = 250;
    let sawTwoTables = false;
    for (let time = 0; time <= 150_000; time += stepMs) {
      const action = script.get(time);
      if (action) {
        await action();
        conserved();
      }
      await scheduler.advance(stepMs);
      conserved();
      if (director.tables().length >= 2) sawTwoTables = true;
    }

    expect(users.size).toBe(8);
    expect(sawTwoTables).toBe(true);
    // Everybody left: every table closed after emptyTableCloseMs.
    expect(director.tables()).toHaveLength(0);
    expect(wallet.total() - house.houseOutstanding()).toBe(SETTINGS.devWalletInitial * 8);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
