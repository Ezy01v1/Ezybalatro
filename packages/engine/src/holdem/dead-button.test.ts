import { describe, expect, it } from 'vitest';
import {
  createStandardDeck,
  isHandInProgress,
  nextHandPositions,
  viewFor,
  type HoldemAction,
  type TableState,
} from '../index';
import { run, stackedDeck, tableWith, totalChips } from '../testing/holdem-fixtures';

/** Deals a hand and folds everyone to the big blind. */
function foldAround(state: TableState): TableState {
  state = run(state, { type: 'postBlinds', deck: createStandardDeck() }).state;
  while (isHandInProgress(state.hand)) {
    const seat = state.hand.toAct!;
    state = run(state, { type: 'fold', playerId: state.seats[seat]!.playerId }).state;
  }
  return state;
}

const positionsOf = (state: TableState) => {
  const p = nextHandPositions(state)!;
  return { button: p.buttonSeat, sb: p.smallBlindSeat, bb: p.bigBlindSeat, dealt: p.dealOrder };
};

/** Players at seats 0, 2 and 4 after one hand (button 0, SB 2, BB 4); seats 1 and 3 are empty. */
function threeHandedAfterOneHand(): TableState {
  let state = tableWith([100, 100, 100, 100, 100]);
  state = run(state, { type: 'sitOut', playerId: 'p1' }, { type: 'sitOut', playerId: 'p3' }).state;
  state = foldAround(state);
  return run(state, { type: 'leave', playerId: 'p1' }, { type: 'leave', playerId: 'p3' }).state;
}

describe('dead button: positions', () => {
  it('the big blind always moves one player; button and small blind follow', () => {
    let state = foldAround(tableWith([100, 100, 100, 100])); // button 0, SB 1, BB 2
    expect(positionsOf(state)).toMatchObject({ button: 1, sb: 2, bb: 3 });
    state = foldAround(state);
    expect(positionsOf(state)).toMatchObject({ button: 2, sb: 3, bb: 0 });
  });

  it('big blind leaves: dead small blind next hand, the button moves normally', () => {
    let state = foldAround(tableWith([100, 100, 100, 100])); // button 0, SB 1, BB 2
    state = run(state, { type: 'leave', playerId: 'p2' }).state;
    expect(positionsOf(state)).toEqual({ button: 1, sb: null, bb: 3, dealt: [3, 0, 1] });
    const { state: next, events } = run(state, { type: 'postBlinds', deck: createStandardDeck() });
    expect(events.filter((e) => e.type === 'blindPosted')).toEqual([
      { type: 'blindPosted', seat: 3, blind: 'big', amount: 2, allIn: false },
    ]);
    expect(next.hand!.toAct).toBe(0);
  });

  it('small blind leaves: dead button on the empty seat', () => {
    let state = foldAround(tableWith([100, 100, 100, 100])); // button 0, SB 1, BB 2
    state = run(state, { type: 'leave', playerId: 'p1' }).state;
    expect(positionsOf(state)).toEqual({ button: 1, sb: 2, bb: 3, dealt: [2, 3, 0] });
    // Postflop, the first to act is the first player left of the (dead) button.
    state = run(
      state,
      { type: 'postBlinds', deck: createStandardDeck() },
      { type: 'call', playerId: 'p0' },
      { type: 'call', playerId: 'p2' },
      { type: 'check', playerId: 'p3' },
    ).state;
    expect([state.hand!.street, state.hand!.toAct]).toEqual(['flop', 2]);
  });

  it('nobody pays the big blind twice in a row when the table goes heads-up', () => {
    let state = foldAround(tableWith([100, 100, 100])); // button 0, SB 1, BB 2
    state = run(state, { type: 'leave', playerId: 'p0' }).state;
    expect(positionsOf(state)).toMatchObject({ button: 2, sb: 2, bb: 1 });
  });

  it('heads-up to 3-handed with a new player behind the button: they wait, button and BB never collide', () => {
    let state = tableWith([100, 100, 100]);
    state = run(state, { type: 'sitOut', playerId: 'p1' }).state;
    state = foldAround(state); // heads-up: button/SB 0, BB 2
    state = run(state, { type: 'leave', playerId: 'p1' }).state;
    state = run(state, {
      type: 'sit',
      playerId: 'c',
      seat: 1,
      buyIn: 100,
      postBlindsToEnter: true,
    }).state;
    // BB moves 2 → 0; SB is 2. The button cannot stay on 0, so it goes right before the SB: seat 1,
    // which is in the dead zone, so the new player waits.
    expect(positionsOf(state)).toEqual({ button: 1, sb: 2, bb: 0, dealt: [2, 0] });
    state = foldAround(state);
    expect(positionsOf(state)).toEqual({ button: 2, sb: 0, bb: 1, dealt: [0, 1, 2] });
  });
});

describe('dead button: new and returning players', () => {
  it('a new player waits for the big blind by default', () => {
    let state = threeHandedAfterOneHand();
    state = run(state, { type: 'sit', playerId: 'new', seat: 1, buyIn: 100 }).state;
    expect(state.seats[1]!.owesBigBlind).toBe(true);

    expect(positionsOf(state)).toEqual({ button: 2, sb: 4, bb: 0, dealt: [4, 0, 2] }); // waits
    state = foldAround(state);
    expect(positionsOf(state)).toMatchObject({ bb: 1 }); // now it is their big blind
    const { state: next, events } = run(state, { type: 'postBlinds', deck: createStandardDeck() });
    expect(events).toContainEqual({
      type: 'blindPosted',
      seat: 1,
      blind: 'big',
      amount: 2,
      allIn: false,
    });
    expect(next.seats[1]!.owesBigBlind).toBe(false);
  });

  it('a new player who chooses to post enters at once with a live big blind (and gets the option)', () => {
    let state = threeHandedAfterOneHand();
    state = run(state, {
      type: 'sit',
      playerId: 'new',
      seat: 1,
      buyIn: 100,
      postBlindsToEnter: true,
    }).state;

    const { state: next, events } = run(state, { type: 'postBlinds', deck: createStandardDeck() });
    // Button 2, SB 4, BB 0; seat 1 posts a second big blind.
    expect(
      events.filter((e) => e.type === 'blindPosted').map((e) => [e.seat, e.blind, e.amount]),
    ).toEqual([
      [4, 'small', 1],
      [0, 'big', 2],
      [1, 'big', 2],
    ]);
    expect(next.seats[1]!.owesBigBlind).toBe(false);
    // The poster acts first (left of the big blind) and can check: their big blind is live.
    expect(next.hand!.toAct).toBe(1);
    expect(viewFor(next, 'new').legal!.canCheck).toBe(true);
  });

  it('a new player in the dead zone (between button and small blind) cannot post to enter', () => {
    let state = threeHandedAfterOneHand(); // next: button 2, SB 4, BB 0
    state = run(state, {
      type: 'sit',
      playerId: 'new',
      seat: 3,
      buyIn: 100,
      postBlindsToEnter: true,
    }).state;
    expect(positionsOf(state).dealt).not.toContain(3);
  });

  it('missed blinds: sitting out owes the blinds that passed; returning posts live BB + dead SB', () => {
    // 4 players. H1: button 0, SB 1, BB 2.
    let state = foldAround(tableWith([100, 100, 100, 100]));
    state = run(state, { type: 'sitOut', playerId: 'p3' }).state;

    // H2: the big blind moves 2 → 0 and skips p3: missed big blind.
    expect(positionsOf(state)).toEqual({ button: 1, sb: 2, bb: 0, dealt: [2, 0, 1] });
    const h2 = run(state, { type: 'postBlinds', deck: createStandardDeck() });
    expect(h2.events).toContainEqual({ type: 'blindMissed', seat: 3, blind: 'big' });
    state = foldAround(state);
    expect(state.seats[3]!.owesBigBlind).toBe(true);

    // p3 comes back and waits: H3 (BB 1) and H4 (BB 2) without them, H5 they are the big blind.
    state = run(state, { type: 'sitIn', playerId: 'p3' }).state;
    expect(positionsOf(state)).toEqual({ button: 2, sb: 0, bb: 1, dealt: [0, 1, 2] });
    state = foldAround(state);
    expect(positionsOf(state)).toEqual({ button: 0, sb: 1, bb: 2, dealt: [1, 2, 0] });
    state = foldAround(state);
    expect(positionsOf(state)).toEqual({ button: 1, sb: 2, bb: 3, dealt: [2, 3, 0, 1] });
    state = foldAround(state);
    expect(state.seats[3]!.owesBigBlind).toBe(false);

    // p3 sits out right after their big blind: H6 their small blind is dead and missed.
    state = run(state, { type: 'sitOut', playerId: 'p3' }).state;
    const h6 = run(state, { type: 'postBlinds', deck: createStandardDeck() });
    expect(h6.state.hand!.smallBlindSeat).toBeNull();
    expect(h6.events).toContainEqual({ type: 'blindMissed', seat: 3, blind: 'small' });
    state = foldAround(state); // H6
    state = foldAround(state); // H7
    state = foldAround(state); // H8
    const h9 = run(state, { type: 'postBlinds', deck: createStandardDeck() });
    expect(h9.events).toContainEqual({ type: 'blindMissed', seat: 3, blind: 'big' });
    state = foldAround(state); // H9
    expect([state.seats[3]!.owesBigBlind, state.seats[3]!.owesSmallBlind]).toEqual([true, true]);

    // Back with "post to enter": H10 seat 3 is in the dead zone; H11 they post 2 live + 1 dead.
    state = run(state, { type: 'sitIn', playerId: 'p3', postBlindsToEnter: true }).state;
    expect(positionsOf(state)).toEqual({ button: 2, sb: 0, bb: 1, dealt: [0, 1, 2] });
    state = foldAround(state);
    expect(positionsOf(state)).toEqual({ button: 0, sb: 1, bb: 2, dealt: [1, 2, 3, 0] });
    const before = totalChips(state);
    const h11 = run(state, { type: 'postBlinds', deck: createStandardDeck() });
    expect(h11.events).toContainEqual({
      type: 'blindPosted',
      seat: 3,
      blind: 'big',
      amount: 2,
      allIn: false,
    });
    expect(h11.events).toContainEqual({
      type: 'blindPosted',
      seat: 3,
      blind: 'dead_small',
      amount: 1,
      allIn: false,
    });
    expect(h11.state.hand!.deadMoney).toBe(1);
    expect([h11.state.seats[3]!.owesBigBlind, h11.state.seats[3]!.owesSmallBlind]).toEqual([
      false,
      false,
    ]);
    expect(totalChips(h11.state)).toBe(before);

    // Everybody folds to the big blind: the pot is SB 1 + BB 2 + p3's live 2 + dead 1.
    state = foldAround(state);
    expect(state.hand!.awards).toEqual([
      { amount: 6, eligibleSeats: [2], winners: [{ seat: 2, amount: 6 }] },
    ]);
    expect(totalChips(state)).toBe(before);
  });
});

describe('showdown: losers muck', () => {
  // Button 0, SB 1, BB 2. Board without straights or flushes.
  const board = '2c 7d 9h Jc 3s';
  const toRiver = (holes: Record<number, string>, river: HoldemAction[]) => {
    const table = tableWith([100, 100, 100]);
    let state = run(table, { type: 'postBlinds', deck: stackedDeck(table, holes, board) }).state;
    state = run(
      state,
      { type: 'call', playerId: 'p0' },
      { type: 'call', playerId: 'p1' },
      { type: 'check', playerId: 'p2' },
    ).state;
    for (let street = 0; street < 2; street++) {
      state = run(
        state,
        { type: 'check', playerId: 'p1' },
        { type: 'check', playerId: 'p2' },
        { type: 'check', playerId: 'p0' },
      ).state;
    }
    return run(state, ...river);
  };
  const checkedDown: HoldemAction[] = [
    { type: 'check', playerId: 'p1' },
    { type: 'check', playerId: 'p2' },
    { type: 'check', playerId: 'p0' },
  ];

  it('checked down: the first player left of the button shows first; other losers muck', () => {
    // p1 shows first with the worst hand; p2 loses and mucks; p0 wins and shows.
    const { state, events } = toRiver({ 0: 'As Ah', 1: '4d 5d', 2: 'Ks Kh' }, checkedDown);
    expect(state.hand!.showdown.map((h) => h.seat)).toEqual([1, 0]);
    expect(state.hand!.mucked).toEqual([2]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'showdown', mucked: [2] }));
    expect(viewFor(state, 'p1').hand!.players.map((p) => p.holeCards?.length ?? null)).toEqual([
      2,
      2,
      null,
    ]);
  });

  it('the river aggressor shows first even when losing', () => {
    const { state } = toRiver({ 0: 'As Ah', 1: '4d 5d', 2: 'Ks Kh' }, [
      { type: 'check', playerId: 'p1' },
      { type: 'bet', playerId: 'p2', amount: 10 },
      { type: 'call', playerId: 'p0' },
      { type: 'fold', playerId: 'p1' },
    ]);
    expect(state.hand!.showdown.map((h) => h.seat)).toEqual([2, 0]);
    expect(state.hand!.mucked).toEqual([]);
  });

  it('callers who lose to the aggressor muck', () => {
    const { state } = toRiver({ 0: 'Ks Kh', 1: '4d 5d', 2: 'As Ah' }, [
      { type: 'check', playerId: 'p1' },
      { type: 'bet', playerId: 'p2', amount: 10 },
      { type: 'call', playerId: 'p0' },
      { type: 'call', playerId: 'p1' },
    ]);
    expect(state.hand!.showdown.map((h) => h.seat)).toEqual([2]);
    expect(state.hand!.mucked).toEqual([0, 1]);
    expect(viewFor(state, 'p1').hand!.players[0]!.holeCards).toBeNull();
  });

  it('tied winners all show', () => {
    const { state } = toRiver({ 0: 'As Kh', 1: '4d 5d', 2: 'Ad Kc' }, checkedDown);
    expect(state.hand!.showdown.map((h) => h.seat)).toEqual([1, 2, 0]);
  });

  it('with an all-in player every hand still in is shown', () => {
    const table = tableWith([100, 100, 100]);
    let state = run(table, {
      type: 'postBlinds',
      deck: stackedDeck(table, { 0: 'As Ah', 1: '4d 5d', 2: 'Ks Kh' }, board),
    }).state;
    state = run(
      state,
      { type: 'allIn', playerId: 'p0' },
      { type: 'call', playerId: 'p1' },
      { type: 'call', playerId: 'p2' },
    ).state;
    expect(state.hand!.showdown).toHaveLength(3);
    expect(state.hand!.mucked).toEqual([]);
  });
});
