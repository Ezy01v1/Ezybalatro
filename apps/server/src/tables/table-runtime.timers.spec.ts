import { createSeededRng, createStandardDeck, shuffleDeck, type HoldemEvent } from '@naipes/engine';
import type { TableRuntime, TableHooks } from './table-runtime';
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

const { betweenHandsMs, turnTimeoutMs, disconnectGraceMs, sittingOutMaxMs } = TEST_TIMINGS;

const ofType = <T extends HoldemEvent['type']>(events: readonly HoldemEvent[], type: T) =>
  events.filter((e): e is Extract<HoldemEvent, { type: T }> => e.type === type);

const autoActs = (h: Harness, playerId = 'p0') =>
  ofType(eventsOf(h, playerId), 'playerActed').filter((e) => e.auto === 'timeout');

const statusOf = (runtime: TableRuntime, playerId: string) => {
  const seat = runtime.seatOf(playerId);
  return seat === null ? null : (runtime.snapshot('').view.seats[seat]?.status ?? null);
};

const toActId = (runtime: TableRuntime): string => {
  const turn = runtime.snapshot('').turn;
  if (!turn) throw new Error('Nobody is to act');
  return runtime.snapshot('').view.seats[turn.seat]!.playerId;
};

/** Two players seated with 1000 each and the first hand dealt (p0 is the button and acts first). */
async function headsUpHand(h: Harness): Promise<void> {
  await join(h, 'p0');
  await join(h, 'p1');
  await h.scheduler.advance(betweenHandsMs);
  expect(h.runtime.isHandInProgress()).toBe(true);
}

describe('TableRuntime timers', () => {
  describe('turn timer', () => {
    it('auto-checks when free and auto-folds when facing a bet after turnTimeoutMs', async () => {
      const h = makeRuntime();
      await headsUpHand(h);
      expect((await h.runtime.act('p0', h.runtime.seq, { type: 'call' })).ok).toBe(true);

      // p1 (big blind) can check.
      await h.scheduler.advance(turnTimeoutMs - 1);
      expect(autoActs(h)).toHaveLength(0);
      await h.scheduler.advance(1);
      expect(autoActs(h)).toEqual([expect.objectContaining({ seat: 1, action: 'check' })]);

      // Heads-up the big blind acts first on the flop: same seat, fresh clock.
      expect(h.runtime.snapshot('p1').view.hand?.street).toBe('flop');
      expect(h.runtime.snapshot('p1').turn).toEqual({ seat: 1, endsInMs: turnTimeoutMs });
      expect((await h.runtime.act('p1', h.runtime.seq, { type: 'bet', amount: 20 })).ok).toBe(true);

      // p0 faces a bet: folds.
      await h.scheduler.advance(turnTimeoutMs);
      expect(autoActs(h)).toEqual([
        expect.objectContaining({ seat: 1, action: 'check' }),
        expect.objectContaining({ seat: 0, action: 'fold' }),
      ]);
      expect(h.runtime.isHandInProgress()).toBe(false);
      expect(h.logger.warn).not.toHaveBeenCalled();
      expect(h.logger.error).not.toHaveBeenCalled();
    });

    it('the timed-out player sits out from the next hand', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      await join(h, 'p1');
      await join(h, 'p2');
      await h.scheduler.advance(betweenHandsMs);
      const slow = toActId(h.runtime);
      const slowSeat = h.runtime.seatOf(slow)!;

      await h.scheduler.advance(turnTimeoutMs);
      expect(autoActs(h)).toEqual([expect.objectContaining({ seat: slowSeat, action: 'fold' })]);
      expect(ofType(eventsOf(h, 'p0'), 'playerSatOut')).toEqual([
        { type: 'playerSatOut', seat: slowSeat, playerId: slow },
      ]);
      expect(statusOf(h.runtime, slow)).toBe('sitting_out');

      await autoPlay(h.runtime, h.scheduler, 1); // finishes hand 1
      await h.scheduler.advance(betweenHandsMs);
      const started = ofType(eventsOf(h, 'p0'), 'handStarted');
      expect(started).toHaveLength(2);
      expect(started[1]!.seats).toHaveLength(2);
      expect(started[1]!.seats).not.toContain(slowSeat);
    });

    it('turn.endsInMs counts down with the scheduler', async () => {
      const h = makeRuntime();
      await headsUpHand(h);
      expect(h.runtime.snapshot('p0').turn).toEqual({ seat: 0, endsInMs: turnTimeoutMs });
      await h.scheduler.advance(5_000);
      expect(h.runtime.snapshot('p1').turn).toEqual({ seat: 0, endsInMs: turnTimeoutMs - 5_000 });
      await h.scheduler.advance(turnTimeoutMs - 5_000 - 1);
      expect(h.runtime.snapshot('p1').turn).toEqual({ seat: 0, endsInMs: 1 });

      // Acting at the last millisecond cancels p0's timer and gives p1 a full clock.
      expect((await h.runtime.act('p0', h.runtime.seq, { type: 'call' })).ok).toBe(true);
      expect(h.runtime.snapshot('p1').turn).toEqual({ seat: 1, endsInMs: turnTimeoutMs });
      await h.scheduler.advance(1);
      expect(autoActs(h)).toHaveLength(0);
      await h.scheduler.advance(turnTimeoutMs - 2);
      expect(autoActs(h)).toHaveLength(0);
      expect(h.runtime.snapshot('p1').turn).toEqual({ seat: 1, endsInMs: 1 });
      await h.scheduler.advance(1);
      expect(autoActs(h)).toHaveLength(1);

      // The update sent after the timeout carries the next clock.
      const last = h.messages.get('p0')!.at(-1)!;
      expect(last.type === 'update' && last.update.turn).toEqual({
        seat: 1,
        endsInMs: turnTimeoutMs,
      });
    });

    it('drops a timeout that fires while the player’s own action is still queued', async () => {
      const h = makeRuntime();
      await headsUpHand(h);
      const call = h.runtime.act('p0', h.runtime.seq, { type: 'call' }); // queued, not run yet
      await h.scheduler.advance(turnTimeoutMs); // p0's timer fires and queues behind the call
      expect((await call).ok).toBe(true);
      expect(autoActs(h)).toHaveLength(0);
      expect(h.runtime.snapshot('p1').turn).toEqual({ seat: 1, endsInMs: turnTimeoutMs });
      expect(h.logger.error).not.toHaveBeenCalled();
    });

    it('has no turn timer between hands', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      await join(h, 'p1');
      expect(h.scheduler.pendingCount()).toBe(1); // the hand start only
      await h.scheduler.advance(betweenHandsMs);
      expect(h.scheduler.pendingCount()).toBe(1); // the turn timer only
      await h.runtime.act('p0', h.runtime.seq, { type: 'fold' });
      expect(h.runtime.isHandInProgress()).toBe(false);
      expect(h.scheduler.pendingCount()).toBe(1); // the next hand start only
    });
  });

  describe('disconnect grace', () => {
    it('disconnect → grace → sitting out; reconnect inside grace cancels it', async () => {
      const h = makeRuntime();
      await join(h, 'p0'); // alone: no hand, no turn timer

      h.runtime.disconnected('nobody');
      expect(h.scheduler.pendingCount()).toBe(0);

      h.runtime.disconnected('p0');
      h.runtime.disconnected('p0');
      expect(h.scheduler.pendingCount()).toBe(1);
      await h.scheduler.advance(disconnectGraceMs - 1);
      expect(statusOf(h.runtime, 'p0')).toBe('seated');
      h.runtime.reconnected('p0');
      expect(h.scheduler.pendingCount()).toBe(0);
      await h.scheduler.advance(disconnectGraceMs);
      expect(statusOf(h.runtime, 'p0')).toBe('seated');
      h.runtime.reconnected('p0'); // no grace running: no-op

      h.runtime.disconnected('p0');
      await h.scheduler.advance(30_000);
      h.runtime.disconnected('p0'); // does not restart the grace
      await h.scheduler.advance(disconnectGraceMs - 30_000);
      expect(statusOf(h.runtime, 'p0')).toBe('sitting_out');
      expect(ofType(eventsOf(h, 'p0'), 'playerSatOut')).toHaveLength(1);
      expect(h.logger.warn).not.toHaveBeenCalled();
      expect(h.logger.error).not.toHaveBeenCalled();
    });

    it('ignores the grace expiry of a player who already sat out', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      await h.runtime.sitOut('p0');
      h.runtime.disconnected('p0');
      await h.scheduler.advance(disconnectGraceMs);
      expect(statusOf(h.runtime, 'p0')).toBe('sitting_out');
      expect(ofType(eventsOf(h, 'p0'), 'playerSatOut')).toHaveLength(1);
      expect(h.logger.warn).not.toHaveBeenCalled();
      expect(h.logger.error).not.toHaveBeenCalled();
    });

    it('a player who leaves loses the grace timer', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      h.runtime.disconnected('p0');
      await h.runtime.leave('p0');
      expect(h.scheduler.pendingCount()).toBe(0);
      await h.scheduler.advance(disconnectGraceMs);
      expect(h.logger.warn).not.toHaveBeenCalled();
      expect(h.logger.error).not.toHaveBeenCalled();
    });
  });

  describe('sitting out', () => {
    it('sitting out for sittingOutMaxMs leaves and credits the wallet', async () => {
      const playerLeft = jest.fn<void, Parameters<TableHooks['playerLeft']>>();
      const h = makeRuntime({ hooks: { playerLeft } });
      await join(h, 'p0');
      await h.runtime.sitOut('p0');
      expect(await h.store.balance('p0')).toBe(TEST_WALLET_INITIAL - 1000);

      await h.scheduler.advance(sittingOutMaxMs - 1);
      expect(h.runtime.seatOf('p0')).toBe(0);
      await h.scheduler.advance(1);
      expect(h.runtime.seatOf('p0')).toBeNull();
      expect(await h.store.balance('p0')).toBe(TEST_WALLET_INITIAL);
      expect(playerLeft).toHaveBeenCalledWith(h.runtime, 'p0', 1000);
      expect(ofType(eventsOf(h, 'p0'), 'playerLeft')).toEqual([
        { type: 'playerLeft', seat: 0, playerId: 'p0', cashOut: 1000 },
      ]);
      expect(h.scheduler.pendingCount()).toBe(0);
    });

    it('a turn timeout starts the sitting-out leave timer', async () => {
      const h = makeRuntime();
      await headsUpHand(h);
      await h.scheduler.advance(turnTimeoutMs); // p0 folds and sits out; p1 wins the blinds
      expect(statusOf(h.runtime, 'p0')).toBe('sitting_out');
      expect(h.runtime.isHandInProgress()).toBe(false);

      await h.scheduler.advance(sittingOutMaxMs - 1);
      expect(h.runtime.seatOf('p0')).toBe(0);
      await h.scheduler.advance(1);
      expect(h.runtime.seatOf('p0')).toBeNull();
      expect(await h.store.balance('p0')).toBe(TEST_WALLET_INITIAL - 10);
      expect(h.runtime.seatOf('p1')).toBe(1); // p1 never sat out
    });

    it('a player who busts sits out and leaves after sittingOutMaxMs', async () => {
      const h = makeRuntime({
        deckSource: fixedDeckSource(() =>
          shuffleDeck(createSeededRng('bust'), createStandardDeck()),
        ),
      });
      await headsUpHand(h);
      expect((await h.runtime.act('p0', h.runtime.seq, { type: 'allIn' })).ok).toBe(true);
      expect((await h.runtime.act('p1', h.runtime.seq, { type: 'call' })).ok).toBe(true);
      expect(h.runtime.isHandInProgress()).toBe(false);
      const busted = ['p0', 'p1'].filter((id) => h.runtime.stackOf(id) === 0);
      expect(busted).toHaveLength(1);
      const [loser] = busted as [string];
      expect(statusOf(h.runtime, loser)).toBe('sitting_out');

      await h.scheduler.advance(sittingOutMaxMs - 1);
      expect(h.runtime.seatOf(loser)).not.toBeNull();
      await h.scheduler.advance(1);
      expect(h.runtime.seatOf(loser)).toBeNull();
      expect(ofType(eventsOf(h, 'p0'), 'playerLeft')).toEqual([
        expect.objectContaining({ playerId: loser, cashOut: 0 }),
      ]);
      expect(h.logger.warn).not.toHaveBeenCalled();
    });

    it('sitIn cancels the sitting-out leave timer', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      await h.runtime.sitOut('p0');
      await h.scheduler.advance(100_000);
      await h.runtime.sitIn('p0');
      expect(h.scheduler.pendingCount()).toBe(0);
      await h.scheduler.advance(sittingOutMaxMs);
      expect(statusOf(h.runtime, 'p0')).toBe('seated');

      // Sitting out again starts a fresh timer.
      await h.runtime.sitOut('p0');
      await h.scheduler.advance(sittingOutMaxMs - 1);
      expect(statusOf(h.runtime, 'p0')).toBe('sitting_out');
      await h.scheduler.advance(1);
      expect(h.runtime.seatOf('p0')).toBeNull();
    });
  });

  describe('closing', () => {
    it('stopDealing prevents the next hand from starting', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      await join(h, 'p1');
      expect(h.runtime.closing).toBe(false);
      h.runtime.stopDealing();
      expect(h.runtime.closing).toBe(true);
      expect(h.scheduler.pendingCount()).toBe(0);
      await h.scheduler.advance(betweenHandsMs * 2);
      expect(h.runtime.isHandInProgress()).toBe(false);
      expect(ofType(eventsOf(h, 'p0'), 'handStarted')).toHaveLength(0);
    });

    it('stopDealing lets the hand in progress finish and starts no other', async () => {
      const h = makeRuntime();
      await headsUpHand(h);
      h.runtime.stopDealing();
      expect(h.runtime.isHandInProgress()).toBe(true);
      expect((await h.runtime.act('p0', h.runtime.seq, { type: 'fold' })).ok).toBe(true);
      expect(ofType(eventsOf(h, 'p0'), 'handSettled')).toHaveLength(1);
      await h.scheduler.advance(betweenHandsMs * 2);
      expect(h.runtime.isHandInProgress()).toBe(false);
      expect(ofType(eventsOf(h, 'p0'), 'handStarted')).toHaveLength(1);
      expect(h.runtime.status).toBe('open');
    });

    it('close cancels every timer', async () => {
      const h = makeRuntime();
      await headsUpHand(h); // turn timer
      await join(h, 'p2');
      await h.runtime.sitOut('p2'); // sitting-out timer
      h.runtime.disconnected('p1'); // grace timer
      expect(h.scheduler.pendingCount()).toBe(3);

      await h.runtime.close('shutdown');
      expect(h.scheduler.pendingCount()).toBe(0);
      expect(h.runtime.closing).toBe(true);
      h.runtime.disconnected('p0');
      expect(h.scheduler.pendingCount()).toBe(0);
      await h.scheduler.advance(sittingOutMaxMs);
      expect(h.logger.warn).not.toHaveBeenCalled();
      expect(h.logger.error).not.toHaveBeenCalled();
      expect(h.store.total()).toBe(3 * TEST_WALLET_INITIAL);
    });
  });
});
