import {
  createSeededRng,
  createStandardDeck,
  nextInt,
  shuffleDeck,
  type HoldemAction,
  type HoldemEvent,
  type HoldemResult,
  type LegalActions,
} from '@naipes/engine';
import type { PlayerAction } from '@naipes/shared';
import { HouseBankroll, InMemoryWallet } from './in-memory-wallet';
import type { WalletPort } from './ports';
import { TableRuntime, isBotId, type TableHooks, type TableMessage } from './table-runtime';
import {
  TEST_CONFIG,
  TEST_TIMINGS,
  TEST_WALLET_INITIAL,
  autoPlay,
  eventsOf,
  fixedDeckSource,
  join,
  listen,
  makeRuntime,
  type Harness,
} from './testing/table-harness';

const { betweenHandsMs, turnTimeoutMs } = TEST_TIMINGS;

const ofType = <T extends HoldemEvent['type']>(events: readonly HoldemEvent[], type: T) =>
  events.filter((e): e is Extract<HoldemEvent, { type: T }> => e.type === type);

const lastMessage = (h: Harness, playerId: string): TableMessage | undefined =>
  h.messages.get(playerId)?.at(-1);

/** Two players seated with 1000 each and the first hand dealt (p0 is the button and acts first). */
async function headsUpHand<R extends TableRuntime>(h: Harness<R>): Promise<void> {
  await join(h, 'p0');
  await join(h, 'p1');
  await h.scheduler.advance(betweenHandsMs);
  expect(h.runtime.isHandInProgress()).toBe(true);
}

describe('TableRuntime', () => {
  describe('sit', () => {
    it('debits the wallet on sit and refunds when the reducer rejects', async () => {
      const h = makeRuntime();
      const debit = jest.spyOn(h.wallet, 'debit');

      const ok = await h.runtime.sit('p0', 1000);
      expect(ok).toEqual({ ok: true, seat: 0 });
      expect(await h.wallet.balance('p0')).toBe(TEST_WALLET_INITIAL - 1000);
      expect(h.runtime.stackOf('p0')).toBe(1000);

      const rejected = await h.runtime.sit('p1', 5000); // above maxBuyIn
      expect(rejected).toEqual({
        ok: false,
        error: expect.objectContaining({ type: 'error', code: 'INVALID_AMOUNT' }),
      });
      expect(debit).toHaveBeenCalledWith('p1', 5000);
      expect(await h.wallet.balance('p1')).toBe(TEST_WALLET_INITIAL);
      expect(h.runtime.seatOf('p1')).toBeNull();
      expect(h.runtime.seq).toBe(1);
    });

    it('rejects a second sit of the same player without touching the wallet', async () => {
      const h = makeRuntime();
      await h.runtime.sit('p0', 1000);
      const debit = jest.spyOn(h.wallet, 'debit');
      const again = await h.runtime.sit('p0', 1000);
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe('INVALID_ACTION');
      expect(debit).not.toHaveBeenCalled();
    });

    it('rejects a non-integer buy-in without touching the wallet', async () => {
      const h = makeRuntime();
      const debit = jest.spyOn(h.wallet, 'debit');
      const result = await h.runtime.sit('p0', 500.5);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_AMOUNT');
      expect(debit).not.toHaveBeenCalled();
    });

    it('answers INSUFFICIENT_CHIPS when the wallet is short', async () => {
      const h = makeRuntime({ wallet: new InMemoryWallet(300) });
      const result = await h.runtime.sit('p0', 400);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_CHIPS');
      expect(await h.wallet.balance('p0')).toBe(300);
      expect(h.runtime.playerCount()).toBe(0);
    });

    it('answers TABLE_FULL when no seat is free, and serializes concurrent sits', async () => {
      const h = makeRuntime({ config: { ...TEST_CONFIG, maxSeats: 2 } });
      await h.runtime.sit('p0', 1000);
      const [a, b] = await Promise.all([h.runtime.sit('p1', 1000), h.runtime.sit('p2', 1000)]);
      expect(a).toEqual({ ok: true, seat: 1 });
      expect(b.ok).toBe(false);
      if (!b.ok) expect(b.error.code).toBe('TABLE_FULL');
      expect(await h.wallet.balance('p2')).toBe(TEST_WALLET_INITIAL);
      expect(h.runtime.hasFreeSeat()).toBe(false);
    });

    it('buys bots in from the house and humans from the wallet', async () => {
      const h = makeRuntime();
      expect(isBotId('bot:Tano')).toBe(true);
      expect(isBotId('dev:ana')).toBe(false);
      await h.runtime.sit('bot:Tano', 2000);
      await h.runtime.sit('dev:ana', 500);
      expect(h.house.outstanding).toBe(2000);
      expect(h.wallet.total()).toBe(TEST_WALLET_INITIAL - 500);
      expect(h.runtime.humanCount()).toBe(1);
      expect(h.runtime.playerCount()).toBe(2);
      expect(h.runtime.playerIds()).toEqual(['bot:Tano', 'dev:ana']);
      expect(h.runtime.chipsOnTable()).toBe(2500);
    });
  });

  describe('hand loop', () => {
    it('starts a hand betweenHandsMs after the second player sits', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      await h.scheduler.advance(betweenHandsMs * 2);
      expect(h.runtime.status).toBe('open');
      await join(h, 'p1');
      await h.scheduler.advance(betweenHandsMs - 1);
      expect(ofType(eventsOf(h, 'p0'), 'handStarted')).toHaveLength(0);
      expect(h.runtime.status).toBe('open');
      await h.scheduler.advance(1);
      expect(ofType(eventsOf(h, 'p0'), 'handStarted')).toHaveLength(1);
      expect(h.runtime.status).toBe('running');
      expect(h.runtime.isHandInProgress()).toBe(true);
    });

    it('sends one update per applied command with all its events and seq + 1', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      await join(h, 'p1');
      const before = h.runtime.seq;
      const count = h.messages.get('p0')!.length;
      await h.scheduler.advance(betweenHandsMs);
      const log = h.messages.get('p0')!;
      expect(log).toHaveLength(count + 1);
      const message = log.at(-1)!;
      if (message.type !== 'update') throw new Error('expected update');
      expect(message.update.seq).toBe(before + 1);
      expect(message.update.events.map((e) => e.type)).toEqual([
        'handStarted',
        'blindPosted',
        'blindPosted',
      ]);
      expect(h.runtime.seq).toBe(before + 1);
    });

    it('starts the next hand betweenHandsMs after one settles', async () => {
      const h = makeRuntime();
      await headsUpHand(h);
      await h.runtime.act('p0', h.runtime.seq, { type: 'fold' });
      expect(h.runtime.status).toBe('open');
      await h.scheduler.advance(betweenHandsMs - 1);
      expect(h.runtime.isHandInProgress()).toBe(false);
      await h.scheduler.advance(1);
      expect(ofType(eventsOf(h, 'p1'), 'handStarted').map((e) => e.handNumber)).toEqual([1, 2]);
    });

    it('reports the turn with a deadline of turnTimeoutMs, and null between hands', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      await join(h, 'p1');
      expect(h.runtime.snapshot('p0').turn).toBeNull();
      await h.scheduler.advance(betweenHandsMs);
      expect(h.runtime.snapshot('p0').turn).toEqual({ seat: 0, endsInMs: turnTimeoutMs });
      await h.scheduler.advance(500);
      expect(h.runtime.snapshot('p1').turn).toEqual({ seat: 0, endsInMs: turnTimeoutMs - 500 });
      await h.runtime.act('p0', h.runtime.seq, { type: 'call' });
      const last = lastMessage(h, 'p0');
      if (last?.type !== 'update') throw new Error('expected update');
      expect(last.update.turn).toEqual({ seat: 1, endsInMs: turnTimeoutMs });
      await h.scheduler.advance(700);
      await h.runtime.act('p1', h.runtime.seq, { type: 'check' });
      // Flop: heads-up the big blind (seat 1) acts first again; a new round restarts the clock.
      expect(h.runtime.snapshot('p1').turn).toEqual({ seat: 1, endsInMs: turnTimeoutMs });
    });
  });

  describe('act', () => {
    it('rejects a stale seq without changing state', async () => {
      const h = makeRuntime();
      await headsUpHand(h);
      const seq = h.runtime.seq;
      const count = h.messages.get('p1')!.length;
      const result = await h.runtime.act('p0', seq - 1, { type: 'call' });
      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'STALE_SEQ' }),
      });
      expect(h.runtime.seq).toBe(seq);
      expect(h.runtime.stackOf('p0')).toBe(990);
      expect(h.messages.get('p1')).toHaveLength(count);
    });

    it('rejects acting when not seated', async () => {
      const h = makeRuntime();
      await headsUpHand(h);
      const result = await h.runtime.act('ghost', h.runtime.seq, { type: 'check' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_AT_TABLE');
    });

    it('maps reducer errors and notifies nobody', async () => {
      const h = makeRuntime();
      await headsUpHand(h);
      const seq = h.runtime.seq;
      const count = h.messages.get('p0')!.length;
      const result = await h.runtime.act('p1', seq, { type: 'check' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_YOUR_TURN');
      const raise = await h.runtime.act('p0', seq, { type: 'raise', to: 25 });
      expect(raise.ok).toBe(false);
      if (!raise.ok) expect(raise.error.code).toBe('INVALID_AMOUNT');
      expect(h.runtime.seq).toBe(seq);
      expect(h.messages.get('p0')).toHaveLength(count);
    });

    it('applies bet, raise and all-in amounts', async () => {
      const h = makeRuntime();
      await headsUpHand(h);
      expect((await h.runtime.act('p0', h.runtime.seq, { type: 'raise', to: 60 })).ok).toBe(true);
      expect(h.runtime.stackOf('p0')).toBe(940);
      expect((await h.runtime.act('p1', h.runtime.seq, { type: 'call' })).ok).toBe(true);
      // Flop: the big blind (p1) acts first heads-up.
      expect((await h.runtime.act('p1', h.runtime.seq, { type: 'bet', amount: 100 })).ok).toBe(
        true,
      );
      expect(h.runtime.stackOf('p1')).toBe(840);
      expect((await h.runtime.act('p0', h.runtime.seq, { type: 'allIn' })).ok).toBe(true);
      expect(h.runtime.stackOf('p0')).toBe(0);
      expect(h.runtime.chipsOnTable()).toBe(2000);
    });
  });

  describe('subscribers', () => {
    it('sends a snapshot on subscribe and replaces the previous listener', async () => {
      const h = makeRuntime();
      await h.runtime.sit('p0', 1000);
      const first = jest.fn();
      const second = jest.fn();
      h.runtime.subscribe('p0', first);
      expect(first).toHaveBeenCalledWith({
        type: 'update',
        update: expect.objectContaining({ tableId: 't1', seq: 1, events: [], turn: null }),
      });
      const unsubscribeSecond = h.runtime.subscribe('p0', second);
      await h.runtime.sit('p1', 1000);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(2);
      unsubscribeSecond();
      await h.runtime.sitOut('p1');
      expect(second).toHaveBeenCalledTimes(2);
    });

    it('sends each subscriber only its own hole cards', async () => {
      const h = makeRuntime({
        deckSource: fixedDeckSource(() =>
          shuffleDeck(createSeededRng('privacy'), createStandardDeck()),
        ),
      });
      await headsUpHand(h);
      const p1Cards = h.runtime
        .snapshot('p1')
        .view.hand!.players.find((p) => p.playerId === 'p1')!.holeCards!;
      const p0Cards = h.runtime
        .snapshot('p0')
        .view.hand!.players.find((p) => p.playerId === 'p0')!.holeCards!;
      expect(p1Cards).toHaveLength(2);
      expect(p0Cards).toHaveLength(2);
      const p0Json = JSON.stringify(h.messages.get('p0'));
      const p1Json = JSON.stringify(h.messages.get('p1'));
      for (const card of p1Cards) expect(p0Json).not.toContain(`"id":"${card.id}"`);
      for (const card of p0Cards) expect(p1Json).not.toContain(`"id":"${card.id}"`);
      for (const card of p0Cards) expect(p0Json).toContain(`"id":"${card.id}"`);
    });

    it('catches a throwing listener, logs it and keeps playing', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      await join(h, 'p1');
      h.runtime.subscribe('p0', (m) => {
        if (m.type === 'update' && m.update.events.length > 0) throw new Error('listener boom');
      });
      await h.scheduler.advance(betweenHandsMs);
      expect(h.logger.error).toHaveBeenCalled();
      const result = await h.runtime.act('p0', h.runtime.seq, { type: 'call' });
      expect(result.ok).toBe(true);
      expect(ofType(eventsOf(h, 'p1'), 'handVoided')).toHaveLength(0);
      expect(ofType(eventsOf(h, 'p1'), 'playerActed')).toHaveLength(1);
    });
  });

  describe('leave', () => {
    it('credits the wallet when a player leaves between hands', async () => {
      const h = makeRuntime();
      await join(h, 'p0', 800);
      const result = await h.runtime.leave('p0');
      expect(result).toEqual({ ok: true, cashOut: 800 });
      expect(await h.wallet.balance('p0')).toBe(TEST_WALLET_INITIAL);
      expect(h.runtime.seatOf('p0')).toBeNull();
      expect(h.runtime.chipsOnTable()).toBe(0);
      const left = ofType(eventsOf(h, 'p0'), 'playerLeft');
      expect(left).toEqual([expect.objectContaining({ playerId: 'p0', cashOut: 800 })]);
    });

    it('credits the house when a bot leaves', async () => {
      const h = makeRuntime();
      await h.runtime.sit('bot:Maru', 1500);
      await h.runtime.leave('bot:Maru');
      expect(h.house.outstanding).toBe(0);
    });

    it('logs a failing credit and still completes the leave without touching the hand', async () => {
      class FlakyWallet extends InMemoryWallet {
        failNextCredit = false;
        override async credit(userId: string, amount: number): Promise<void> {
          if (this.failNextCredit) {
            this.failNextCredit = false;
            throw new Error('credit boom');
          }
          return super.credit(userId, amount);
        }
      }
      const wallet = new FlakyWallet(TEST_WALLET_INITIAL);
      const hooks = { playerLeft: jest.fn(), changed: jest.fn() };
      const h = makeRuntime({ wallet, hooks });
      await join(h, 'p0');
      await join(h, 'p1');
      await join(h, 'p2');
      await h.runtime.sitOut('p2');
      await h.scheduler.advance(betweenHandsMs);
      expect(h.runtime.isHandInProgress()).toBe(true); // p0 and p1 only
      const seq = h.runtime.seq;
      const changedCalls = hooks.changed.mock.calls.length;
      const p2Count = h.messages.get('p2')!.length;

      wallet.failNextCredit = true;
      const result = await h.runtime.leave('p2');

      expect(result).toEqual({ ok: true, cashOut: 1000 });
      expect(h.logger.error).toHaveBeenCalledTimes(1);
      expect(h.runtime.seq).toBe(seq + 1);
      for (const id of ['p0', 'p1', 'p2']) {
        expect(ofType(eventsOf(h, id), 'playerLeft')).toEqual([
          expect.objectContaining({ playerId: 'p2', cashOut: 1000 }),
        ]);
      }
      expect(hooks.playerLeft).toHaveBeenCalledWith(h.runtime, 'p2', 1000);
      expect(hooks.changed).toHaveBeenCalledTimes(changedCalls + 1);
      expect(h.messages.get('p2')).toHaveLength(p2Count + 1);
      expect(await wallet.balance('p2')).toBe(TEST_WALLET_INITIAL - 1000); // lost, logged
      // The hand in progress is untouched and the table stays healthy.
      expect(ofType(eventsOf(h, 'p0'), 'handVoided')).toHaveLength(0);
      expect(h.runtime.status).toBe('running');
      expect(h.runtime.chipsOnTable()).toBe(2000);
      expect((await h.runtime.act('p0', h.runtime.seq, { type: 'call' })).ok).toBe(true);
      expect(h.messages.get('p2')).toHaveLength(p2Count + 1); // unsubscribed
      expect(h.logger.error).toHaveBeenCalledTimes(1);
    });

    it('leave while all-in stays until settle and cashes out the final stack', async () => {
      const h = makeRuntime();
      await headsUpHand(h);
      expect((await h.runtime.act('p0', h.runtime.seq, { type: 'allIn' })).ok).toBe(true);
      const leave = await h.runtime.leave('p0');
      expect(leave).toEqual({ ok: true, cashOut: null });
      expect(h.runtime.seatOf('p0')).toBe(0);
      expect(await h.wallet.balance('p0')).toBe(TEST_WALLET_INITIAL - 1000);
      expect(ofType(eventsOf(h, 'p1'), 'playerActed').at(-1)?.action).not.toBe('fold');

      await h.runtime.act('p1', h.runtime.seq, { type: 'call' });
      const settled = ofType(eventsOf(h, 'p1'), 'handSettled').at(-1)!;
      const finalStack = settled.stacks.find((s) => s.seat === 0)!.stack;
      const left = ofType(eventsOf(h, 'p1'), 'playerLeft');
      expect(left).toEqual([expect.objectContaining({ playerId: 'p0', cashOut: finalStack })]);
      expect(await h.wallet.balance('p0')).toBe(TEST_WALLET_INITIAL - 1000 + finalStack);
      expect(h.runtime.seatOf('p0')).toBeNull();
      // p0 got this last update, then was unsubscribed.
      expect(ofType(eventsOf(h, 'p0'), 'playerLeft')).toHaveLength(1);
      const p0Count = h.messages.get('p0')!.length;
      await h.scheduler.advance(betweenHandsMs);
      await h.runtime.sit('p2', 1000);
      expect(h.messages.get('p0')).toHaveLength(p0Count);
    });
  });

  describe('internal failures', () => {
    class FailingRuntime extends TableRuntime {
      failNextBettingAction = false;
      protected override apply(action: HoldemAction): HoldemResult {
        if (this.failNextBettingAction && 'playerId' in action && action.type !== 'sit') {
          this.failNextBettingAction = false;
          throw new Error('apply boom');
        }
        return super.apply(action);
      }
    }

    it('voids the hand and keeps the table alive when a command throws', async () => {
      const h = makeRuntime({}, FailingRuntime);
      await headsUpHand(h);
      expect(h.runtime.stackOf('p0')).toBe(990);
      h.runtime.failNextBettingAction = true;
      const result = await h.runtime.act('p0', h.runtime.seq, { type: 'call' });
      expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'INTERNAL' }) });
      expect(h.logger.error).toHaveBeenCalledTimes(1);
      expect(ofType(eventsOf(h, 'p1'), 'handVoided')).toEqual([
        { type: 'handVoided', handNumber: 1 },
      ]);
      expect(h.runtime.stackOf('p0')).toBe(1000);
      expect(h.runtime.stackOf('p1')).toBe(1000);
      expect(h.runtime.status).toBe('open');

      await h.scheduler.advance(betweenHandsMs - 1);
      expect(ofType(eventsOf(h, 'p1'), 'handStarted')).toHaveLength(1);
      await h.scheduler.advance(1);
      expect(ofType(eventsOf(h, 'p1'), 'handStarted').map((e) => e.handNumber)).toEqual([1, 2]);
      expect((await h.runtime.act('p0', h.runtime.seq, { type: 'fold' })).ok).toBe(false); // p1 is the button now
      expect((await h.runtime.act('p1', h.runtime.seq, { type: 'fold' })).ok).toBe(true);
    });

    it('logs a failing deck source, deals no hand and retries on the next start', async () => {
      let calls = 0;
      const h = makeRuntime({
        deckSource: fixedDeckSource(() => {
          calls++;
          if (calls === 1) throw new Error('deck boom');
          return createStandardDeck();
        }),
      });
      await join(h, 'p0');
      await join(h, 'p1');
      const seq = h.runtime.seq;
      await h.scheduler.advance(betweenHandsMs);
      expect(h.logger.error).toHaveBeenCalledTimes(1);
      expect(h.runtime.isHandInProgress()).toBe(false);
      expect(h.runtime.seq).toBe(seq);
      expect(ofType(eventsOf(h, 'p0'), 'handVoided')).toHaveLength(0);
      await h.scheduler.advance(betweenHandsMs);
      expect(ofType(eventsOf(h, 'p0'), 'handStarted')).toHaveLength(1);
      expect(h.runtime.status).toBe('running');
    });

    class LeakyRuntime extends TableRuntime {
      leak(chips: number): void {
        this.expectedChips += chips;
      }
    }

    it('closes with reason error and refunds starting stacks on a conservation mismatch', async () => {
      const closed = jest.fn();
      const h = makeRuntime({ hooks: { closed } }, LeakyRuntime);
      await headsUpHand(h);
      await h.runtime.sit('bot:Tano', 1000); // seated but not dealt in
      h.runtime.leak(1);
      const result = await h.runtime.act('p0', h.runtime.seq, { type: 'raise', to: 100 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INTERNAL');
      expect(h.logger.error).toHaveBeenCalled();
      expect(lastMessage(h, 'p1')).toEqual({
        type: 'closed',
        closed: { tableId: 't1', reason: 'error' },
      });
      expect(h.runtime.status).toBe('closed');
      expect(closed).toHaveBeenCalledWith(h.runtime);
      expect(await h.wallet.balance('p0')).toBe(TEST_WALLET_INITIAL);
      expect(await h.wallet.balance('p1')).toBe(TEST_WALLET_INITIAL);
      expect(h.house.outstanding).toBe(0);
      expect(h.runtime.chipsOnTable()).toBe(0);
      expect(ofType(eventsOf(h, 'p1'), 'handVoided')).toHaveLength(0);
      const after = await h.runtime.act('p1', h.runtime.seq, { type: 'call' });
      expect(after.ok).toBe(false);
      if (!after.ok) expect(after.error.code).toBe('TABLE_CLOSED');
    });
  });

  describe('close', () => {
    it('voids the hand, cashes everybody out, notifies and calls the hook', async () => {
      const hooks = { closed: jest.fn(), playerLeft: jest.fn() };
      const h = makeRuntime({ hooks });
      await headsUpHand(h);
      await h.runtime.sit('bot:Tano', 1000);
      await h.runtime.act('p0', h.runtime.seq, { type: 'raise', to: 200 });
      await h.runtime.close('shutdown');

      expect(ofType(eventsOf(h, 'p1'), 'handVoided')).toHaveLength(1);
      expect(lastMessage(h, 'p0')).toEqual({
        type: 'closed',
        closed: { tableId: 't1', reason: 'shutdown' },
      });
      expect(await h.wallet.balance('p0')).toBe(TEST_WALLET_INITIAL);
      expect(await h.wallet.balance('p1')).toBe(TEST_WALLET_INITIAL);
      expect(h.house.outstanding).toBe(0);
      expect(hooks.playerLeft).toHaveBeenCalledTimes(3);
      expect(hooks.closed).toHaveBeenCalledTimes(1);
      expect(h.runtime.status).toBe('closed');
      expect(h.runtime.playerCount()).toBe(0);

      const sit = await h.runtime.sit('p3', 1000);
      expect(sit.ok).toBe(false);
      if (!sit.ok) expect(sit.error.code).toBe('TABLE_CLOSED');
      await h.runtime.close('shutdown');
      expect(hooks.closed).toHaveBeenCalledTimes(1);
      await h.scheduler.advance(betweenHandsMs * 3);
      expect(ofType(eventsOf(h, 'p0'), 'handStarted')).toHaveLength(1);
    });

    it('closeIfEmpty closes with reason empty only when no human is seated', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      await h.runtime.sit('bot:Tano', 1000);
      await h.runtime.sit('bot:Maru', 1000);
      await h.scheduler.advance(betweenHandsMs); // a hand is in progress

      expect(await h.runtime.closeIfEmpty()).toBe(false);
      expect(h.runtime.status).toBe('running');

      await h.runtime.leave('p0'); // folds now, leaves at settle
      expect(await h.runtime.closeIfEmpty()).toBe(false); // still listed until the hand settles
      await autoPlay(h.runtime, h.scheduler, 1);
      expect(h.runtime.humanCount()).toBe(0);

      listen(h, 'observer');
      expect(await h.runtime.closeIfEmpty()).toBe(true);
      expect(h.runtime.status).toBe('closed');
      expect(lastMessage(h, 'observer')).toEqual({
        type: 'closed',
        closed: { tableId: 't1', reason: 'empty' },
      });
      // Everybody cashed out: what the bots won from p0 is what the house is up.
      expect(h.wallet.total() - h.house.outstanding).toBe(TEST_WALLET_INITIAL);
      expect(h.runtime.chipsOnTable()).toBe(0);
      expect(await h.runtime.closeIfEmpty()).toBe(false); // already closed
    });

    it('closeIfEmpty does not close onto a human whose sit was queued first', async () => {
      const real = new InMemoryWallet(TEST_WALLET_INITIAL);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const wallet: WalletPort = {
        balance: (id) => real.balance(id),
        // A slow debit (e.g. a DB round trip) keeps the sit in flight.
        debit: async (id, amount) => {
          await gate;
          return real.debit(id, amount);
        },
        credit: (id, amount) => real.credit(id, amount),
      };
      const h = makeRuntime({ wallet });
      await h.runtime.sit('bot:Tano', 1000);
      expect(h.runtime.humanCount()).toBe(0);

      const sitting = h.runtime.sit('p0', 1000);
      const closing = h.runtime.closeIfEmpty();
      release();

      expect(await sitting).toEqual({ ok: true, seat: 1 });
      expect(await closing).toBe(false);
      expect(h.runtime.status).not.toBe('closed');
      expect(h.runtime.humanCount()).toBe(1);
      expect(await real.balance('p0')).toBe(TEST_WALLET_INITIAL - 1000);
    });
  });

  describe('hooks', () => {
    it('calls changed, playerLeft and afterHand', async () => {
      const hooks: Partial<TableHooks> = {
        changed: jest.fn(),
        playerLeft: jest.fn(),
        afterHand: jest.fn(),
      };
      const h = makeRuntime({ hooks });
      await headsUpHand(h);
      expect(hooks.changed).toHaveBeenCalledTimes(3); // sit, sit, start
      expect(hooks.afterHand).not.toHaveBeenCalled();
      await h.runtime.act('p0', h.runtime.seq, { type: 'fold' });
      expect(hooks.afterHand).toHaveBeenCalledTimes(1);
      await h.runtime.leave('p1');
      expect(hooks.playerLeft).toHaveBeenCalledWith(h.runtime, 'p1', 1010);
      expect(hooks.changed).toHaveBeenCalledTimes(5);
    });

    it('a throwing hook is logged and does not break the table', async () => {
      const h = makeRuntime({
        hooks: {
          changed: () => {
            throw new Error('hook boom');
          },
        },
      });
      await join(h, 'p0');
      await join(h, 'p1');
      await h.scheduler.advance(betweenHandsMs);
      expect(h.logger.error).toHaveBeenCalled();
      expect(h.runtime.isHandInProgress()).toBe(true);
    });
  });

  describe('sitOut / sitIn', () => {
    it('applies them and keeps a sitting-out player out of the next hand', async () => {
      const h = makeRuntime();
      await join(h, 'p0');
      await join(h, 'p1');
      await join(h, 'p2');
      expect((await h.runtime.sitOut('p2')).ok).toBe(true);
      await h.scheduler.advance(betweenHandsMs);
      expect(ofType(eventsOf(h, 'p0'), 'handStarted')[0]?.seats).toEqual([0, 1]);
      const again = await h.runtime.sitOut('p2');
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe('INVALID_ACTION');
      expect((await h.runtime.sitIn('p2', true)).ok).toBe(true);
      const ghost = await h.runtime.sitIn('ghost');
      expect(ghost.ok).toBe(false);
      if (!ghost.ok) expect(ghost.error.code).toBe('NOT_AT_TABLE');
    });
  });

  describe('conservation', () => {
    it('keeps wallet + chipsOnTable + house.outstanding constant across 200 hands', async () => {
      const wallet = new InMemoryWallet(TEST_WALLET_INITIAL);
      const house = new HouseBankroll();
      let deckCount = 0;
      const h = makeRuntime({
        wallet,
        house,
        deckSource: fixedDeckSource(() =>
          shuffleDeck(createSeededRng('conservation', `deck-${deckCount++}`), createStandardDeck()),
        ),
      });
      const humans = ['p0', 'p1', 'p2', 'p3'];
      const players = [...humans, 'bot:Tano'];
      for (const id of players) await join(h, id);
      const total = () => wallet.total() + h.runtime.chipsOnTable() - house.outstanding;
      const expected = TEST_WALLET_INITIAL * humans.length;
      expect(total()).toBe(expected);

      const rng = createSeededRng('conservation', 'actions');
      const pick = (n: number) => nextInt(rng, n);
      const choose = (legal: LegalActions): PlayerAction => {
        const roll = pick(100);
        if (roll < 3 && legal.allIn !== null) return { type: 'allIn' };
        if (roll < 20 && legal.raise) return { type: 'raise', to: legal.raise.min };
        if (roll < 30 && legal.bet) return { type: 'bet', amount: legal.bet.min };
        if (roll < 38 && !legal.canCheck) return { type: 'fold' };
        return legal.canCheck ? { type: 'check' } : { type: 'call' };
      };

      let busts = 0;
      let deferredLeaves = 0;
      let rejoins = 0;
      const afterStep = async () => {
        expect(total()).toBe(expected);
        const view = h.runtime.snapshot('').view;
        for (const seat of view.seats) {
          if (!seat) continue;
          if (seat.status === 'sitting_out' && seat.stack === 0 && !h.runtime.isHandInProgress()) {
            busts++;
            await h.runtime.leave(seat.playerId);
          } else if (seat.status === 'sitting_out' && pick(2) === 0) {
            await h.runtime.sitIn(seat.playerId, pick(2) === 0);
          } else if (seat.status === 'seated' && !isBotId(seat.playerId) && pick(100) === 0) {
            if (pick(2) === 0) {
              await h.runtime.sitOut(seat.playerId);
            } else {
              const left = await h.runtime.leave(seat.playerId);
              if (left.ok && left.cashOut === null) deferredLeaves++;
            }
          }
        }
        for (const id of players) {
          if (h.runtime.seatOf(id) !== null || pick(3) !== 0) continue;
          const source = isBotId(id) ? house : wallet;
          const buyIn = Math.min(1000, await source.balance(id));
          if (buyIn >= 400) {
            await join(h, id, buyIn, pick(2) === 0);
            rejoins++;
          }
        }
        expect(total()).toBe(expected);
      };

      await autoPlay(h.runtime, h.scheduler, 200, { choose, afterStep });
      expect(h.runtime.snapshot('').view.handNumber).toBeGreaterThanOrEqual(200);
      expect(h.logger.error).not.toHaveBeenCalled();
      expect(deferredLeaves).toBeGreaterThan(0);
      expect(rejoins).toBeGreaterThan(0);
      expect(busts).toBeGreaterThan(0);
      await h.runtime.close('shutdown');
      expect(h.runtime.chipsOnTable()).toBe(0);
      expect(h.runtime.playerCount()).toBe(0);
      expect(wallet.total() - house.outstanding).toBe(expected);
    });
  });

  describe('accessors', () => {
    it('exposes id, createdAt and seat helpers', async () => {
      const h = makeRuntime();
      await h.scheduler.advance(100);
      expect(h.runtime.id).toBe('t1');
      expect(h.runtime.createdAt).toBe(0);
      await join(h, 'p0');
      expect(h.runtime.seatOf('p0')).toBe(0);
      expect(h.runtime.stackOf('nobody')).toBeNull();
      expect(h.runtime.hasFreeSeat()).toBe(true);
    });
  });
});
