import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildPots, createStandardDeck, splitPot } from '../index';
import { run, stacksOf, tableWith } from '../testing/holdem-fixtures';

describe('buildPots', () => {
  it('single pot when nobody is all-in for less', () => {
    expect(
      buildPots([
        { seat: 0, totalBet: 20, folded: false },
        { seat: 1, totalBet: 20, folded: false },
        { seat: 2, totalBet: 5, folded: true },
      ]),
    ).toEqual([{ amount: 45, eligibleSeats: [0, 1] }]);
  });

  it('layers side pots by all-in size; folded chips fill layers without eligibility', () => {
    // 30 all-in, 80 all-in, 200 and a fold after putting in 100.
    expect(
      buildPots([
        { seat: 0, totalBet: 30, folded: false },
        { seat: 1, totalBet: 80, folded: false },
        { seat: 2, totalBet: 200, folded: false },
        { seat: 3, totalBet: 100, folded: true },
      ]),
    ).toEqual([
      { amount: 120, eligibleSeats: [0, 1, 2] }, // 30 × 4
      { amount: 150, eligibleSeats: [1, 2] }, // 50 × 3
      { amount: 140, eligibleSeats: [2] }, // 20 from seat 3 + 120 uncalled from seat 2
    ]);
  });

  it('a player still in with nothing committed takes the folded chips (regression)', () => {
    expect(
      buildPots([
        { seat: 0, totalBet: 0, folded: false },
        { seat: 3, totalBet: 1, folded: true },
        { seat: 4, totalBet: 2, folded: true },
      ]),
    ).toEqual([{ amount: 3, eligibleSeats: [0] }]);
  });

  it('pots always add up to the chips committed', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ totalBet: fc.nat({ max: 1000 }), folded: fc.boolean() }), {
          minLength: 2,
          maxLength: 6,
        }),
        (players) => {
          const contributions = players.map((p, seat) => ({ seat, ...p }));
          fc.pre(contributions.some((c) => !c.folded));
          const total = contributions.reduce((sum, c) => sum + c.totalBet, 0);
          const pots = buildPots(contributions);
          expect(pots.reduce((sum, p) => sum + p.amount, 0)).toBe(total);
          for (const pot of pots)
            expect(pot.eligibleSeats.every((s) => !contributions[s]!.folded)).toBe(true);
        },
      ),
    );
  });
});

describe('splitPot', () => {
  it('odd chips go to the winners closest to the left of the button', () => {
    expect(splitPot(10, [1, 4, 5], 4, 6)).toEqual([
      { seat: 5, amount: 4 },
      { seat: 1, amount: 3 },
      { seat: 4, amount: 3 },
    ]);
    expect(splitPot(7, [0, 2], 0, 3)).toEqual([
      { seat: 2, amount: 4 },
      { seat: 0, amount: 3 },
    ]);
  });
});

describe('walk to a player who has not acted (regression found by the chip-conservation property)', () => {
  it('the button wins the blinds when both blinds leave', () => {
    let state = run(tableWith([100, 100, 100]), {
      type: 'postBlinds',
      deck: createStandardDeck(),
    }).state;
    state = run(state, { type: 'leave', playerId: 'p1' }, { type: 'leave', playerId: 'p2' }).state;
    expect(state.hand!.street).toBe('settled');
    expect(state.hand!.awards).toEqual([
      { amount: 3, eligibleSeats: [0], winners: [{ seat: 0, amount: 3 }] },
    ]);
    expect(stacksOf(state).slice(0, 3)).toEqual([103, null, null]);
  });
});
