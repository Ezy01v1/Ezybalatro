import { describe, expect, it } from 'vitest';
import {
  createStandardDeck,
  createTable,
  holdemReducer,
  legalActions,
  type HoldemAction,
  type TableState,
} from '../index';
import {
  BLINDS_1_2,
  deepFreeze,
  run,
  stackedDeck,
  stacksOf,
  tableWith,
  totalChips,
} from '../testing/holdem-fixtures';

const deal = (state: TableState, holes: Record<number, string> = {}, board = '') =>
  run(state, { type: 'postBlinds', deck: stackedDeck(state, holes, board) });

const errorOf = (state: TableState, action: HoldemAction) => {
  const result = holdemReducer(state, action);
  if (result.ok) throw new Error('Expected the action to be rejected');
  return result.error.code;
};

const checkAround = (state: TableState): TableState => {
  while (state.hand?.toAct != null) {
    state = run(state, { type: 'check', playerId: `p${state.hand.toAct}` }).state;
  }
  return state;
};

describe('createTable', () => {
  it('rejects invalid configs', () => {
    expect(() => createTable({ ...BLINDS_1_2, maxSeats: 7 })).toThrow(RangeError);
    expect(() => createTable({ ...BLINDS_1_2, smallBlind: 3 })).toThrow(RangeError);
    expect(() => createTable({ ...BLINDS_1_2, minBuyIn: 0 })).toThrow(RangeError);
  });
});

describe('seats', () => {
  it('validates sitting down', () => {
    const state = tableWith([100]);
    expect(errorOf(state, { type: 'sit', playerId: 'x', seat: 0, buyIn: 100 })).toBe('SEAT_TAKEN');
    expect(errorOf(state, { type: 'sit', playerId: 'x', seat: 6, buyIn: 100 })).toBe(
      'INVALID_SEAT',
    );
    expect(errorOf(state, { type: 'sit', playerId: 'p0', seat: 1, buyIn: 100 })).toBe(
      'ALREADY_SEATED',
    );
    expect(errorOf(state, { type: 'sit', playerId: 'x', seat: 1, buyIn: 0 })).toBe(
      'INVALID_BUY_IN',
    );
    expect(errorOf(state, { type: 'sit', playerId: 'x', seat: 1, buyIn: 1.5 })).toBe(
      'INVALID_BUY_IN',
    );
  });

  it('leaves immediately between hands, cashing out the stack', () => {
    const { state, events } = run(tableWith([100, 80]), { type: 'leave', playerId: 'p1' });
    expect(state.seats[1]).toBeNull();
    expect(events).toEqual([{ type: 'playerLeft', seat: 1, playerId: 'p1', cashOut: 80 }]);
    expect(errorOf(state, { type: 'leave', playerId: 'p1' })).toBe('NOT_SEATED');
  });

  it('sits out and back in', () => {
    let state = run(tableWith([100, 100, 100]), { type: 'sitOut', playerId: 'p1' }).state;
    expect(errorOf(state, { type: 'sitOut', playerId: 'p1' })).toBe('INVALID_ACTION');
    state = deal(state).state;
    expect(state.hand!.players.map((p) => p.seat)).toEqual([0, 2]);
    expect(errorOf(state, { type: 'sitIn', playerId: 'p0' })).toBe('INVALID_ACTION');
    state = run(state, { type: 'sitIn', playerId: 'p1' }).state;
    expect(state.seats[1]!.status).toBe('seated');
  });
});

describe('starting a hand', () => {
  it('needs 2 players with chips and a complete deck', () => {
    expect(errorOf(tableWith([100]), { type: 'postBlinds', deck: createStandardDeck() })).toBe(
      'NOT_ENOUGH_PLAYERS',
    );
    const two = tableWith([100, 100]);
    expect(errorOf(two, { type: 'postBlinds', deck: createStandardDeck().slice(1) })).toBe(
      'INVALID_DECK',
    );
    const started = deal(two).state;
    expect(errorOf(started, { type: 'postBlinds', deck: createStandardDeck() })).toBe(
      'HAND_IN_PROGRESS',
    );
  });

  it('3-handed: button, blinds, first to act left of the big blind; postflop left of the button', () => {
    const { state, events } = deal(tableWith([100, 100, 100]));
    const hand = state.hand!;
    expect([hand.buttonSeat, hand.smallBlindSeat, hand.bigBlindSeat, hand.toAct]).toEqual([
      0, 1, 2, 0,
    ]);
    expect(events.filter((e) => e.type === 'blindPosted')).toEqual([
      { type: 'blindPosted', seat: 1, blind: 'small', amount: 1, allIn: false },
      { type: 'blindPosted', seat: 2, blind: 'big', amount: 2, allIn: false },
    ]);
    expect(hand.players.every((p) => p.holeCards.length === 2)).toBe(true);
    expect(hand.deck).toHaveLength(52 - 6);

    const flop = run(
      state,
      { type: 'call', playerId: 'p0' },
      { type: 'call', playerId: 'p1' },
      { type: 'check', playerId: 'p2' },
    ).state;
    expect(flop.hand!.street).toBe('flop');
    expect(flop.hand!.board).toHaveLength(3);
    expect(flop.hand!.toAct).toBe(1);
  });

  it('moves the button clockwise, skipping empty and sitting-out seats', () => {
    let state = tableWith([100, 100, 100, 100]);
    state = run(state, { type: 'sitOut', playerId: 'p1' }).state;
    const first = deal(state).state;
    expect(first.hand!.buttonSeat).toBe(0);
    const folded = run(
      first,
      { type: 'fold', playerId: 'p0' },
      { type: 'fold', playerId: 'p2' },
    ).state;
    expect(folded.hand!.street).toBe('settled');
    expect(deal(folded).state.hand!.buttonSeat).toBe(2);
  });
});

describe('heads-up', () => {
  it('button posts the small blind, acts first preflop and last after the flop', () => {
    let state = deal(tableWith([100, 100])).state;
    const hand = state.hand!;
    expect([hand.buttonSeat, hand.smallBlindSeat, hand.bigBlindSeat, hand.toAct]).toEqual([
      0, 0, 1, 0,
    ]);
    state = run(state, { type: 'call', playerId: 'p0' }).state;
    expect(state.hand!.toAct).toBe(1); // big blind option
    state = run(state, { type: 'check', playerId: 'p1' }).state;
    expect(state.hand!.street).toBe('flop');
    expect(state.hand!.toAct).toBe(1);
    state = run(state, { type: 'check', playerId: 'p1' }).state;
    expect(state.hand!.toAct).toBe(0);
  });

  it('the button alternates between hands', () => {
    const state = run(deal(tableWith([100, 100])).state, { type: 'fold', playerId: 'p0' }).state;
    const next = deal(state).state.hand!;
    expect([next.buttonSeat, next.smallBlindSeat, next.bigBlindSeat, next.toAct]).toEqual([
      1, 1, 0, 1,
    ]);
  });
});

describe('betting rules', () => {
  it('validates turn, check, call and amounts', () => {
    const state = deal(tableWith([1000, 1000, 1000, 1000])).state; // button 0, SB 1, BB 2, UTG 3
    expect(errorOf(state, { type: 'call', playerId: 'p0' })).toBe('NOT_YOUR_TURN');
    expect(errorOf(state, { type: 'call', playerId: 'nobody' })).toBe('NOT_YOUR_TURN');
    expect(errorOf(state, { type: 'check', playerId: 'p3' })).toBe('INVALID_ACTION');
    expect(errorOf(state, { type: 'bet', playerId: 'p3', amount: 10 })).toBe('INVALID_ACTION');
    expect(errorOf(state, { type: 'raise', playerId: 'p3', to: 3 })).toBe('INVALID_AMOUNT');
    expect(errorOf(state, { type: 'raise', playerId: 'p3', to: 1001 })).toBe('INVALID_AMOUNT');
    expect(errorOf(state, { type: 'raise', playerId: 'p3', to: 4.5 })).toBe('INVALID_AMOUNT');
    expect(errorOf(createTable(BLINDS_1_2), { type: 'fold', playerId: 'p0' })).toBe(
      'NO_HAND_IN_PROGRESS',
    );
  });

  it('minimum raise is the size of the last full raise', () => {
    let state = deal(tableWith([1000, 1000, 1000, 1000])).state;
    state = run(state, { type: 'raise', playerId: 'p3', to: 6 }).state; // raise of 4
    expect(errorOf(state, { type: 'raise', playerId: 'p0', to: 9 })).toBe('INVALID_AMOUNT');
    state = run(state, { type: 'raise', playerId: 'p0', to: 10 }).state; // raise of 4
    expect(legalActions(state, 'p1')!.raise).toEqual({ min: 14, max: 1000 });
    state = run(state, { type: 'raise', playerId: 'p1', to: 30 }).state; // raise of 20
    expect(legalActions(state, 'p2')!.raise).toEqual({ min: 50, max: 1000 });
  });

  it('postflop bets are at least the big blind unless all-in', () => {
    let state = deal(tableWith([100, 100])).state;
    state = run(state, { type: 'call', playerId: 'p0' }, { type: 'check', playerId: 'p1' }).state;
    expect(errorOf(state, { type: 'bet', playerId: 'p1', amount: 1 })).toBe('INVALID_AMOUNT');
    expect(errorOf(state, { type: 'raise', playerId: 'p1', to: 4 })).toBe('INVALID_ACTION');
    expect(legalActions(state, 'p1')!.bet).toEqual({ min: 2, max: 98 });
    state = run(state, { type: 'bet', playerId: 'p1', amount: 10 }).state;
    expect(legalActions(state, 'p0')!.raise).toEqual({ min: 20, max: 98 });
  });

  it('an incomplete all-in raise does not reopen the action to players who already acted', () => {
    // Seats: 0 = D (212), 1 = A (1000), 2 = B (1000), 3 = C (152). Button 0, SB 1, BB 2.
    let state = deal(tableWith([212, 1000, 1000, 152])).state;
    state = run(
      state,
      { type: 'call', playerId: 'p3' },
      { type: 'call', playerId: 'p0' },
      { type: 'call', playerId: 'p1' },
      { type: 'check', playerId: 'p2' },
    ).state;
    expect(state.hand!.street).toBe('flop');
    state = run(
      state,
      { type: 'bet', playerId: 'p1', amount: 100 },
      { type: 'call', playerId: 'p2' },
    ).state;
    state = run(state, { type: 'allIn', playerId: 'p3' }).state; // to 150: raise of 50 < 100
    expect(state.hand!.currentBet).toBe(150);
    expect(state.hand!.minRaise).toBe(100);
    // D has not acted yet: may raise.
    expect(legalActions(state, 'p0')!.raise).not.toBeNull();
    const afterFold = run(state, { type: 'fold', playerId: 'p0' }).state;
    const aOptions = legalActions(afterFold, 'p1')!;
    expect(aOptions.raise).toBeNull();
    expect(aOptions.allIn).toBeNull();
    expect(aOptions.callAmount).toBe(50);
    expect(errorOf(afterFold, { type: 'raise', playerId: 'p1', to: 400 })).toBe('INVALID_ACTION');
    const turn = run(
      afterFold,
      { type: 'call', playerId: 'p1' },
      { type: 'call', playerId: 'p2' },
    ).state;
    expect(turn.hand!.street).toBe('turn');
  });

  it('short all-ins that add up to a full raise do reopen the action', () => {
    let state = deal(tableWith([212, 1000, 1000, 152])).state;
    state = run(
      state,
      { type: 'call', playerId: 'p3' },
      { type: 'call', playerId: 'p0' },
      { type: 'call', playerId: 'p1' },
      { type: 'check', playerId: 'p2' },
      { type: 'bet', playerId: 'p1', amount: 100 },
      { type: 'call', playerId: 'p2' },
      { type: 'allIn', playerId: 'p3' }, // to 150 (+50)
      { type: 'allIn', playerId: 'p0' }, // to 210 (+60): 110 over A's bet ≥ 100
    ).state;
    expect(state.hand!.minRaise).toBe(100);
    expect(legalActions(state, 'p1')!.raise).toEqual({ min: 310, max: 998 });
  });

  it('a big blind all-in for less still makes the others call the full big blind', () => {
    let state = deal(
      tableWith([100, 100, 1]),
      { 0: 'Ks Kh', 1: 'Qs Qh', 2: 'As Ah' },
      '2c 7d 9h Jc 3s',
    ).state;
    expect(state.hand!.players[2]!.allIn).toBe(true);
    expect(state.hand!.currentBet).toBe(2);
    expect(legalActions(state, 'p0')!.callAmount).toBe(2);
    state = run(state, { type: 'call', playerId: 'p0' }, { type: 'call', playerId: 'p1' }).state;
    state = checkAround(state);
    expect(state.hand!.street).toBe('settled');
    // Main pot 3 (1 each) to p2's aces; side pot 2 (p0, p1) to p0's kings.
    expect(state.hand!.awards.map((a) => [a.amount, a.eligibleSeats, a.winners])).toEqual([
      [3, [0, 1, 2], [{ seat: 2, amount: 3 }]],
      [2, [0, 1], [{ seat: 0, amount: 2 }]],
    ]);
    expect(stacksOf(state)).toEqual([100, 98, 3, null, null, null]);
  });

  it('a player facing an all-in with nobody else left can only call or fold', () => {
    let state = deal(tableWith([100, 50])).state;
    state = run(state, { type: 'allIn', playerId: 'p0' }).state;
    const options = legalActions(state, 'p1')!;
    expect(options.raise).toBeNull();
    expect(options.callAmount).toBe(48);
    expect(options.allIn).toBe(48);
  });
});

describe('settling', () => {
  it('everyone folds to the big blind: blinds go to the big blind without showdown', () => {
    const { state, events } = run(
      deal(tableWith([100, 100, 100])).state,
      { type: 'fold', playerId: 'p0' },
      { type: 'fold', playerId: 'p1' },
    );
    expect(state.hand!.street).toBe('settled');
    expect(state.hand!.showdown).toEqual([]);
    expect(events.some((e) => e.type === 'showdown')).toBe(false);
    expect(stacksOf(state).slice(0, 3)).toEqual([100, 99, 101]);
  });

  it('returns an uncalled bet', () => {
    let state = deal(tableWith([100, 100])).state;
    state = run(
      state,
      { type: 'raise', playerId: 'p0', to: 20 },
      { type: 'fold', playerId: 'p1' },
    ).state;
    // A single pot (p0's 20 + p1's folded 2): only p0 is eligible, so the uncalled 18 come back with the blinds.
    expect(state.hand!.awards).toEqual([
      { amount: 22, eligibleSeats: [0], winners: [{ seat: 0, amount: 22 }] },
    ]);
    expect(stacksOf(state).slice(0, 2)).toEqual([102, 98]);
  });

  it('splits a tied pot and gives the odd chip to the first winner left of the button', () => {
    // Button 0, SB 1, BB 2. Pot = 2 + 1 (folded SB) + 2 = 5, board plays for p0 and p2.
    let state = deal(
      tableWith([100, 100, 100]),
      { 0: '2c 3d', 1: '4c 5d', 2: '2d 3c' },
      'As Ks Qs Js Ts',
    ).state;
    state = run(
      state,
      { type: 'call', playerId: 'p0' },
      { type: 'fold', playerId: 'p1' },
      { type: 'check', playerId: 'p2' },
    ).state;
    state = checkAround(state);
    expect(state.hand!.awards).toEqual([
      {
        amount: 5,
        eligibleSeats: [0, 2],
        winners: [
          { seat: 2, amount: 3 },
          { seat: 0, amount: 2 },
        ],
      },
    ]);
    expect(stacksOf(state).slice(0, 3)).toEqual([100, 99, 101]);
    expect(state.hand!.showdown.map((h) => h.category)).toEqual([
      'straight_flush',
      'straight_flush',
    ]);
  });

  it('busted players sit out and cannot sit back in', () => {
    let state = deal(tableWith([50, 50]), { 0: 'As Ah', 1: 'Ks Kh' }, '2c 7d 9h Jc 3s').state;
    state = run(state, { type: 'allIn', playerId: 'p0' }, { type: 'call', playerId: 'p1' }).state;
    expect(stacksOf(state).slice(0, 2)).toEqual([100, 0]);
    expect(state.seats[1]!.status).toBe('sitting_out');
    expect(errorOf(state, { type: 'sitIn', playerId: 'p1' })).toBe('INVALID_ACTION');
    expect(errorOf(state, { type: 'postBlinds', deck: createStandardDeck() })).toBe(
      'NOT_ENOUGH_PLAYERS',
    );
  });
});

describe('side pots (amounts computed by hand)', () => {
  // 3 players all-in preflop with 50 / 150 / 300. Button 0 (A), SB 1 (B), BB 2 (C).
  // A shoves 50, B shoves 150; C can only call 150 (nobody left to raise against), so C keeps 150.
  // Main = 50 × 3 = 150 (A, B, C) · Side = 100 × 2 = 200 (B, C).
  const threeWay = (holes: Record<number, string>) => {
    let state = deal(tableWith([50, 150, 300]), holes, '2c 7d 9h Jc 3s').state;
    expect(legalActions(state, 'p0')!.allIn).toBe(50);
    state = run(state, { type: 'allIn', playerId: 'p0' }, { type: 'allIn', playerId: 'p1' }).state;
    expect(legalActions(state, 'p2')!.allIn).toBeNull();
    return run(state, { type: 'call', playerId: 'p2' }).state;
  };

  it('3 players: shortest stack best, middle second', () => {
    const state = threeWay({ 0: 'As Ah', 1: 'Ks Kh', 2: 'Qs Qh' });
    expect(state.hand!.awards.map((a) => [a.amount, a.eligibleSeats, a.winners])).toEqual([
      [150, [0, 1, 2], [{ seat: 0, amount: 150 }]],
      [200, [1, 2], [{ seat: 1, amount: 200 }]],
    ]);
    expect(stacksOf(state).slice(0, 3)).toEqual([150, 200, 150]);
  });

  it('3 players: tie in the side pot', () => {
    const state = threeWay({ 0: 'As Ah', 1: 'Ks Kh', 2: 'Kd Kc' });
    expect(state.hand!.awards.map((a) => a.winners)).toEqual([
      [{ seat: 0, amount: 150 }],
      [
        { seat: 1, amount: 100 },
        { seat: 2, amount: 100 },
      ],
    ]);
    expect(stacksOf(state).slice(0, 3)).toEqual([150, 100, 250]);
  });

  // 4 players: A 100, B 250, C 400, D 600. Button 0 (A), SB 1 (B), BB 2 (C), UTG 3 (D).
  // D shoves 600 and everyone calls all-in. Contributions 100 / 250 / 400 / 600:
  // Main = 100 × 4 = 400 (all) · Side 1 = 150 × 3 = 450 (B, C, D) · Side 2 = 150 × 2 = 300 (C, D)
  // · D's last 200 are uncalled and go back to D.
  const fourWay = (holes: Record<number, string>) => {
    let state = deal(tableWith([100, 250, 400, 600]), holes, '2c 7d 9h 4c 3s').state;
    state = run(
      state,
      { type: 'allIn', playerId: 'p3' },
      { type: 'allIn', playerId: 'p0' },
      { type: 'allIn', playerId: 'p1' },
      { type: 'allIn', playerId: 'p2' },
    ).state;
    expect(state.hand!.street).toBe('settled');
    expect(state.hand!.board).toHaveLength(5);
    return state;
  };

  it('4 players: winners in order of stack size', () => {
    const state = fourWay({ 0: 'As Ah', 1: 'Ks Kh', 2: 'Qs Qh', 3: 'Js Jh' });
    expect(state.hand!.awards.map((a) => [a.amount, a.eligibleSeats, a.winners])).toEqual([
      [400, [0, 1, 2, 3], [{ seat: 0, amount: 400 }]],
      [450, [1, 2, 3], [{ seat: 1, amount: 450 }]],
      [300, [2, 3], [{ seat: 2, amount: 300 }]],
      [200, [3], [{ seat: 3, amount: 200 }]],
    ]);
    expect(stacksOf(state).slice(0, 4)).toEqual([400, 450, 300, 200]);
  });

  it('4 players: middle stack best, biggest stack second', () => {
    const state = fourWay({ 0: 'Qs Qh', 1: 'As Ah', 2: 'Ts 8h', 3: 'Ks Kh' });
    // B wins main (400) and side 1 (450); D beats C for side 2 (300) and gets 200 back.
    expect(stacksOf(state).slice(0, 4)).toEqual([0, 850, 0, 500]);
  });
});

describe('leave, timeout and void', () => {
  it('leaving on your turn folds; the seat is freed with its stack when the hand settles', () => {
    let state = deal(tableWith([100, 100, 100])).state;
    const left = run(state, { type: 'leave', playerId: 'p0' });
    expect(left.events[0]).toMatchObject({
      type: 'playerActed',
      seat: 0,
      action: 'fold',
      auto: 'leave',
    });
    expect(left.state.seats[0]!.status).toBe('leaving');
    state = run(left.state, { type: 'fold', playerId: 'p1' }).state;
    expect(state.seats[0]).toBeNull();
  });

  it('leaving out of turn folds without changing who acts', () => {
    const { state, events } = run(deal(tableWith([100, 100, 100])).state, {
      type: 'leave',
      playerId: 'p2',
    });
    expect(state.hand!.toAct).toBe(0);
    expect(state.hand!.players[2]!.folded).toBe(true);
    expect(events).toHaveLength(1);
  });

  it('leaving heads-up ends the hand and frees the seat at once', () => {
    const { state, events } = run(deal(tableWith([100, 100])).state, {
      type: 'leave',
      playerId: 'p0',
    });
    expect(state.hand!.street).toBe('settled');
    expect(state.seats[0]).toBeNull();
    expect(events.at(-1)).toEqual({ type: 'playerLeft', seat: 0, playerId: 'p0', cashOut: 99 });
  });

  it('an all-in player who leaves stays in the hand until it settles', () => {
    let state = deal(
      tableWith([100, 100, 100]),
      { 0: 'As Ah', 1: 'Ks Kh', 2: 'Qs Qh' },
      '2c 7d 9h Jc 3s',
    ).state;
    state = run(state, { type: 'allIn', playerId: 'p0' }, { type: 'leave', playerId: 'p0' }).state;
    expect(state.seats[0]!.status).toBe('leaving');
    const { events } = run(
      state,
      { type: 'call', playerId: 'p1' },
      { type: 'fold', playerId: 'p2' },
    );
    expect(events).toContainEqual({ type: 'playerLeft', seat: 0, playerId: 'p0', cashOut: 202 });
  });

  it('timeout checks when free, folds when facing a bet, and sits the player out', () => {
    let state = deal(tableWith([100, 100, 100])).state;
    state = run(state, { type: 'call', playerId: 'p0' }, { type: 'call', playerId: 'p1' }).state;
    const checked = run(state, { type: 'timeout', playerId: 'p2' });
    expect(checked.events).toContainEqual({
      type: 'playerActed',
      seat: 2,
      action: 'check',
      amount: 0,
      to: 2,
      allIn: false,
      auto: 'timeout',
    });
    expect(checked.state.seats[2]!.status).toBe('sitting_out');
    expect(checked.state.hand!.street).toBe('flop');

    const headsUp = deal(tableWith([100, 100])).state;
    const folded = run(headsUp, { type: 'timeout', playerId: 'p0' });
    expect(folded.events).toContainEqual(
      expect.objectContaining({ action: 'fold', auto: 'timeout' }),
    );
    expect(folded.state.hand!.street).toBe('settled');
  });

  it('voiding a hand restores the stacks from before the blinds', () => {
    let state = deal(tableWith([100, 100, 100])).state;
    state = run(
      state,
      { type: 'raise', playerId: 'p0', to: 30 },
      { type: 'leave', playerId: 'p1' },
    ).state;
    const { state: voided, events } = run(state, { type: 'voidHand' });
    expect(voided.hand!.street).toBe('voided');
    expect(stacksOf(voided).slice(0, 3)).toEqual([100, null, 100]);
    expect(events).toContainEqual({ type: 'playerLeft', seat: 1, playerId: 'p1', cashOut: 100 });
    expect(errorOf(voided, { type: 'voidHand' })).toBe('NO_HAND_IN_PROGRESS');
    expect(deal(voided).state.hand!.street).toBe('preflop');
  });
});

describe('purity', () => {
  it('never mutates the input state', () => {
    let state = deepFreeze(tableWith([100, 100, 100]));
    const actions: HoldemAction[] = [
      { type: 'postBlinds', deck: createStandardDeck() },
      { type: 'raise', playerId: 'p0', to: 10 },
      { type: 'call', playerId: 'p1' },
      { type: 'leave', playerId: 'p2' },
      { type: 'check', playerId: 'p1' },
      { type: 'bet', playerId: 'p0', amount: 20 },
      { type: 'allIn', playerId: 'p1' },
      { type: 'call', playerId: 'p0' },
    ];
    for (const action of actions) {
      const before = totalChips(state);
      const result = run(state, action);
      const cashedOut = result.events.reduce(
        (sum, e) => sum + (e.type === 'playerLeft' ? e.cashOut : 0),
        0,
      );
      state = deepFreeze(result.state);
      expect(totalChips(state) + cashedOut).toBe(before);
    }
    expect(state.hand!.street).toBe('settled');
  });
});
