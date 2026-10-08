import {
  createSeededRng,
  createStandardDeck,
  shuffleDeck,
  type HoldemAction,
  type HoldemEvent,
  type HoldemResult,
  type TableState,
} from '@naipes/engine';
import { InMemoryTableStore } from './in-memory-table-store';
import { TableRuntime, type TableMessage } from './table-runtime';
import type { HandRecord } from './table-store';
import {
  TEST_TIMINGS,
  TEST_WALLET_INITIAL,
  autoPlay,
  eventsOf,
  fixedDeckSource,
  join,
  makeRuntime,
  type Harness,
} from './testing/table-harness';

const { betweenHandsMs } = TEST_TIMINGS;

const ofType = <T extends HoldemEvent['type']>(events: readonly HoldemEvent[], type: T) =>
  events.filter((e): e is Extract<HoldemEvent, { type: T }> => e.type === type);

const degradedFlags = (h: Harness, playerId: string): boolean[] =>
  (h.messages.get(playerId) ?? []).flatMap((m: TableMessage) =>
    m.type === 'degraded' ? [m.degraded.degraded] : [],
  );

const handsStarted = (h: Harness) => ofType(eventsOf(h, 'p0'), 'handStarted').length;

/** p0 (button, small blind) and p1 with 1000 each; the first hand dealt. */
async function headsUp(h: Harness): Promise<void> {
  await join(h, 'p0');
  await join(h, 'p1');
  await h.scheduler.advance(betweenHandsMs);
  expect(h.runtime.isHandInProgress()).toBe(true);
}

const lastRecord = (store: InMemoryTableStore): HandRecord => store.persistedHands().at(-1)!;

describe('TableRuntime persistence', () => {
  it('does not start the next hand until persistHand resolves', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    class SlowStore extends InMemoryTableStore {
      override async persistHand(record: HandRecord): Promise<void> {
        await gate;
        return super.persistHand(record);
      }
    }
    const store = new SlowStore({ initial: TEST_WALLET_INITIAL });
    const h = makeRuntime({ store });
    await headsUp(h);

    const fold = h.runtime.act('p0', h.runtime.seq, { type: 'fold' });
    await h.scheduler.advance(betweenHandsMs * 3);
    expect(handsStarted(h)).toBe(1);
    expect(store.persistedHands()).toHaveLength(0);

    release();
    expect((await fold).ok).toBe(true);
    expect(store.persistedHands()).toHaveLength(1);
    await h.scheduler.advance(betweenHandsMs);
    expect(handsStarted(h)).toBe(2);
  });

  it('records every action of the hand in the HandRecord (blinds included)', async () => {
    const h = makeRuntime();
    await headsUp(h);
    const act = (id: string, action: Parameters<typeof h.runtime.act>[2]) =>
      h.runtime.act(id, h.runtime.seq, action);
    await act('p0', { type: 'call' });
    await act('p1', { type: 'check' });
    await act('p1', { type: 'check' });
    await act('p0', { type: 'bet', amount: 40 });
    await act('p1', { type: 'fold' });

    const record = lastRecord(h.store);
    expect(record).toMatchObject({
      tableId: 't1',
      handNumber: 1,
      status: 'settled',
      buttonSeat: 0,
      shownHands: [],
      stacks: [
        { seat: 0, stack: 1020 },
        { seat: 1, stack: 980 },
      ],
      leavers: [],
    });
    expect(record.board).toHaveLength(3);
    expect(record.awards).toEqual([
      expect.objectContaining({ amount: 80, winners: [{ seat: 0, amount: 80 }] }),
    ]);
    expect(record.actions).toEqual([
      { seq: 1, seat: 0, street: 'preflop', type: 'post_blind', amount: 10 },
      { seq: 2, seat: 1, street: 'preflop', type: 'post_blind', amount: 20 },
      { seq: 3, seat: 0, street: 'preflop', type: 'call', amount: 10 },
      { seq: 4, seat: 1, street: 'preflop', type: 'check', amount: 0 },
      { seq: 5, seat: 1, street: 'flop', type: 'check', amount: 0 },
      { seq: 6, seat: 0, street: 'flop', type: 'bet', amount: 40 },
      { seq: 7, seat: 1, street: 'flop', type: 'fold', amount: 0 },
    ]);
    expect(h.store.seatRows('t1')).toEqual([
      { seat: 0, playerId: 'p0', stack: 1020 },
      { seat: 1, playerId: 'p1', stack: 980 },
    ]);
  });

  it('records all-ins and timeouts', async () => {
    const h = makeRuntime();
    await headsUp(h);
    await h.scheduler.advance(TEST_TIMINGS.turnTimeoutMs); // p0 times out: folds
    expect(lastRecord(h.store).actions.at(-1)).toEqual({
      seq: 3,
      seat: 0,
      street: 'preflop',
      type: 'timeout',
      amount: 0,
    });

    await h.runtime.sitIn('p0');
    await h.scheduler.advance(betweenHandsMs);
    expect(h.runtime.isHandInProgress()).toBe(true);
    const toAct = h.runtime.snapshot('').view.hand!.toAct!;
    const id = h.runtime.snapshot('').view.seats[toAct]!.playerId;
    await h.runtime.act(id, h.runtime.seq, { type: 'allIn' });
    const other = h.runtime.snapshot('').view.seats[h.runtime.snapshot('').view.hand!.toAct!]!;
    await h.runtime.act(other.playerId, h.runtime.seq, { type: 'call' });
    const allIn = lastRecord(h.store);
    expect(allIn).toMatchObject({ handNumber: 2, status: 'settled' });
    // Equal stacks: the call is an all-in too.
    expect(allIn.actions.filter((a) => a.type === 'all_in')).toEqual([
      expect.objectContaining({ seq: 3, seat: toAct, street: 'preflop' }),
      expect.objectContaining({ seq: 4, seat: 1 - toAct, street: 'preflop' }),
    ]);
    expect(allIn.board).toHaveLength(5);

    await h.runtime.close('shutdown');
    expect(h.store.seatRows('t1')).toEqual([]);
    expect(h.store.total()).toBe(2 * TEST_WALLET_INITIAL);
  });

  it('a hand voided by the close is saved too, with the stacks restored and no actions', async () => {
    const h = makeRuntime();
    await headsUp(h);
    await h.runtime.act('p0', h.runtime.seq, { type: 'raise', to: 100 });
    await h.runtime.close('shutdown');
    const voided = lastRecord(h.store);
    expect(voided).toMatchObject({
      handNumber: 1,
      status: 'voided',
      actions: [],
      awards: [],
      shownHands: [],
      stacks: [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 1000 },
      ],
    });
    expect(h.store.seatRows('t1')).toEqual([]);
    expect(h.store.total()).toBe(2 * TEST_WALLET_INITIAL);
  });

  it('a failing persistHand marks the table degraded, retries at 1/2/4/8/15 s and resumes', async () => {
    const h = makeRuntime();
    await headsUp(h);
    const calls: number[] = [];
    const persist = h.store.persistHand.bind(h.store);
    jest.spyOn(h.store, 'persistHand').mockImplementation((record) => {
      calls.push(h.scheduler.now());
      return persist(record);
    });
    h.store.failNext('persistHand', 6);
    const t0 = h.scheduler.now();

    expect((await h.runtime.act('p0', h.runtime.seq, { type: 'fold' })).ok).toBe(true);
    expect(h.runtime.degraded).toBe(true);
    expect(degradedFlags(h, 'p0')).toEqual([true]);
    expect(degradedFlags(h, 'p1')).toEqual([true]);

    // A new player cannot sit while degraded.
    const sit = await h.runtime.sit('p2', 1000);
    expect(sit.ok).toBe(false);
    if (!sit.ok) expect(sit.error.code).toBe('INTERNAL');
    expect(await h.store.balance('p2')).toBe(TEST_WALLET_INITIAL);

    await h.scheduler.advance(44_999);
    expect(calls.map((t) => t - t0)).toEqual([0, 1000, 3000, 7000, 15_000, 30_000]);
    expect(handsStarted(h)).toBe(1);
    expect(h.runtime.degraded).toBe(true);

    await h.scheduler.advance(1);
    expect(calls.map((t) => t - t0)).toEqual([0, 1000, 3000, 7000, 15_000, 30_000, 45_000]);
    expect(h.runtime.degraded).toBe(false);
    expect(degradedFlags(h, 'p0')).toEqual([true, false]);
    expect(h.store.persistedHands()).toHaveLength(1);
    expect(h.logger.error).toHaveBeenCalledTimes(6);
    for (const [message] of h.logger.error.mock.calls)
      expect(message).not.toMatch(/[2-9TJQKA][shdc]/);

    await h.scheduler.advance(betweenHandsMs);
    expect(handsStarted(h)).toBe(2);
  });

  it('a leave during degradation waits for the next successful persistHand', async () => {
    const playerLeft = jest.fn();
    const h = makeRuntime({ hooks: { playerLeft } });
    await headsUp(h);
    h.store.failNext('persistHand');
    const standUp = jest.spyOn(h.store, 'standUp');
    await h.runtime.act('p0', h.runtime.seq, { type: 'fold' }); // p1 wins 10
    expect(h.runtime.degraded).toBe(true);

    expect(await h.runtime.leave('p1')).toEqual({ ok: true, cashOut: null });
    expect(h.runtime.isLeavePending('p1')).toBe(true);
    expect(h.runtime.seatOf('p1')).toBe(1);
    expect(standUp).not.toHaveBeenCalled();
    expect(await h.store.balance('p1')).toBe(TEST_WALLET_INITIAL - 1000);
    expect(playerLeft).not.toHaveBeenCalled();

    await h.scheduler.advance(1000);
    expect(h.runtime.degraded).toBe(false);
    expect(standUp).not.toHaveBeenCalled();
    expect(lastRecord(h.store)).toMatchObject({
      stacks: [{ seat: 0, stack: 990 }],
      leavers: [{ playerId: 'p1', seat: 1, cashOut: 1010 }],
    });
    expect(await h.store.balance('p1')).toBe(TEST_WALLET_INITIAL + 10);
    expect(h.runtime.seatOf('p1')).toBeNull();
    expect(h.runtime.isLeavePending('p1')).toBe(false);
    expect(ofType(eventsOf(h, 'p0'), 'playerLeft')).toEqual([
      expect.objectContaining({ playerId: 'p1', cashOut: 1010 }),
    ]);
    expect(playerLeft).toHaveBeenCalledWith(h.runtime, 'p1', 1010);
    expect(h.store.seatRows('t1')).toEqual([{ seat: 0, playerId: 'p0', stack: 990 }]);
    expect(h.runtime.chipsOnTable()).toBe(990);
  });

  it('a save that committed but lost its acknowledgement is not retried forever', async () => {
    const playerLeft = jest.fn();
    const h = makeRuntime({ hooks: { playerLeft } });
    await headsUp(h);
    h.store.loseNextPersistAck();
    const standUp = jest.spyOn(h.store, 'standUp');
    await h.runtime.act('p0', h.runtime.seq, { type: 'fold' }); // committed, but "failed"
    expect(h.runtime.degraded).toBe(true);
    expect(h.store.persistedHands()).toHaveLength(1);

    // p1 leaves while degraded: the retried record (with p1 as leaver) finds the hand already saved.
    expect(await h.runtime.leave('p1')).toEqual({ ok: true, cashOut: null });
    await h.scheduler.advance(1000);

    expect(h.runtime.degraded).toBe(false);
    expect(h.store.persistedHands()).toHaveLength(1);
    expect(standUp).toHaveBeenCalledTimes(1);
    expect(standUp).toHaveBeenCalledWith({ tableId: 't1', seat: 1, playerId: 'p1', cashOut: 1010 });
    expect(playerLeft).toHaveBeenCalledTimes(1);
    expect(h.runtime.seatOf('p1')).toBeNull();
    expect(h.runtime.isLeavePending('p1')).toBe(false);
    expect(await h.store.balance('p1')).toBe(TEST_WALLET_INITIAL + 10);
    expect(h.store.seatRows('t1')).toEqual([{ seat: 0, playerId: 'p0', stack: 990 }]);
    expect(h.store.total() + h.store.seatedTotal()).toBe(2 * TEST_WALLET_INITIAL);
    expect(h.runtime.chipsOnTable()).toBe(990);

    // The table is usable again: a new player can sit and a hand is dealt.
    await join(h, 'p2');
    await h.scheduler.advance(betweenHandsMs);
    expect(h.runtime.isHandInProgress()).toBe(true);
  });

  it('closing with an unsaved hand stands nobody up: the store keeps the pre-hand stacks', async () => {
    const h = makeRuntime();
    await join(h, 'p0');
    await join(h, 'p1');
    await join(h, 'p2');
    const held = () => h.store.total() + h.store.seatedTotal() - h.store.houseOutstanding();
    const before = held();
    await h.scheduler.advance(betweenHandsMs);
    h.store.failNext('persistHand', 1_000_000);
    const standUp = jest.spyOn(h.store, 'standUp');
    // p2 leaves with the hand (freed at settle); the others stay.
    await h.runtime.leave('p2');
    while (h.runtime.isHandInProgress()) {
      const view = h.runtime.snapshot('').view;
      const id = view.seats[view.hand!.toAct!]!.playerId;
      await h.runtime.act(id, h.runtime.seq, { type: 'fold' });
    }
    expect(h.runtime.degraded).toBe(true);
    await h.scheduler.advance(5000);

    await h.runtime.close('shutdown');
    expect(h.runtime.status).toBe('closed');
    expect(standUp).not.toHaveBeenCalled();
    expect(h.store.seatRows('t1')).toEqual([
      { seat: 0, playerId: 'p0', stack: 1000 },
      { seat: 1, playerId: 'p1', stack: 1000 },
      { seat: 2, playerId: 'p2', stack: 1000 },
    ]);
    expect(held()).toBe(before);
    for (const [message] of h.logger.error.mock.calls)
      expect(message).not.toMatch(/[2-9TJQKA][shdc]/);
  });

  it('a sit the engine rejects or throws on is stood up again: the wallet is restored', async () => {
    class ThrowingSit extends TableRuntime {
      throwOnSit = false;
      protected override apply(action: HoldemAction, state?: TableState): HoldemResult {
        if (this.throwOnSit && action.type === 'sit') throw new Error('sit boom');
        return super.apply(action, state);
      }
    }
    const h = makeRuntime({}, ThrowingSit);
    const held = () => h.store.total() + h.store.seatedTotal() - h.store.houseOutstanding();
    await join(h, 'p0');
    const before = held();
    const rejected = await h.runtime.sit('p1', 5000); // above maxBuyIn: the engine rejects
    expect(rejected.ok).toBe(false);
    expect(await h.store.balance('p1')).toBe(TEST_WALLET_INITIAL);
    h.runtime.throwOnSit = true;
    const thrown = await h.runtime.sit('p2', 1000);
    expect(thrown.ok).toBe(false);
    if (!thrown.ok) expect(thrown.error.code).toBe('INTERNAL');
    expect(await h.store.balance('p2')).toBe(TEST_WALLET_INITIAL);
    expect(h.store.seatRows('t1')).toEqual([{ seat: 0, playerId: 'p0', stack: 1000 }]);
    expect(held()).toBe(before + 2 * TEST_WALLET_INITIAL); // p1 and p2 wallets created, untouched
    expect(h.runtime.seatOf('p2')).toBeNull();
  });

  it('a failing standUp between hands keeps the player seated and acks INTERNAL', async () => {
    const h = makeRuntime();
    await join(h, 'p0', 800);
    h.store.failNext('standUp');
    const result = await h.runtime.leave('p0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INTERNAL');
    expect(h.runtime.seatOf('p0')).toBe(0);
    expect(await h.store.balance('p0')).toBe(TEST_WALLET_INITIAL - 800);
    expect(h.store.seatRows('t1')).toEqual([{ seat: 0, playerId: 'p0', stack: 800 }]);
    expect(await h.runtime.leave('p0')).toEqual({ ok: true, cashOut: 800 });
  });

  it('only shown hands go into HandRecord.shownHands', async () => {
    let n = 0;
    const h = makeRuntime({
      deckSource: fixedDeckSource(() =>
        shuffleDeck(createSeededRng('shown', `deck-${n++}`), createStandardDeck()),
      ),
    });
    await join(h, 'p0');
    await join(h, 'p1');
    await join(h, 'p2');
    let checked = 0;
    for (let i = 0; i < 30 && checked === 0; i++) {
      const before = ofType(eventsOf(h, 'p0'), 'showdown').length;
      await autoPlay(h.runtime, h.scheduler, 1);
      const showdowns = ofType(eventsOf(h, 'p0'), 'showdown');
      if (showdowns.length === before) continue;
      const showdown = showdowns.at(-1)!;
      const record = lastRecord(h.store);
      if (showdown.mucked.length === 0) continue;
      expect(record.shownHands).toEqual(showdown.hands);
      const shownSeats = record.shownHands.map((s) => s.seat);
      for (const seat of showdown.mucked) expect(shownSeats).not.toContain(seat);
      checked++;
    }
    expect(checked).toBe(1);
  });
});
