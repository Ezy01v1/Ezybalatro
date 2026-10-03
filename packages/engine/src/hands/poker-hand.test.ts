import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bestHand,
  compareHands,
  createSeededRng,
  createStandardDeck,
  evaluateFive,
  parseCards,
  shuffleDeck,
  type Card,
} from '../index';

const best = (text: string) => bestHand(parseCards(text));

describe('evaluateFive / bestHand: known hands', () => {
  it.each([
    ['As Ks Qs Js Ts 2d 3c', 'straight_flush', [14]],
    ['5h 4h 3h 2h Ah Kd Kc', 'straight_flush', [5]],
    ['9c 9d 9h 9s Ad 2c 3c', 'four_of_a_kind', [9, 14]],
    ['Kc Kd Kh 2s 2d 2c 7h', 'full_house', [13, 2]],
    ['Ah Kh 9h 5h 2h Ad Ac', 'flush', [14, 13, 9, 5, 2]],
    ['Td 9c 8h 7s 6d 2c 2d', 'straight', [10]],
    ['As 2d 3c 4h 5s Kd Qc', 'straight', [5]],
    ['Ah Ad Ac 9s 7d 3c 2h', 'three_of_a_kind', [14, 9, 7]],
    ['Ah Ad Kc Ks 7d 7c 2h', 'two_pair', [14, 13, 7]],
    ['Qh Qd 9c 7s 5d 3c 2h', 'pair', [12, 9, 7, 5]],
    ['Ah Jd 9c 7s 5d 3c 2h', 'high_card', [14, 11, 9, 7, 5]],
  ] as const)('%s → %s', (cards, category, tiebreak) => {
    const hand = best(cards);
    expect(hand.category).toBe(category);
    expect(hand.tiebreak).toEqual(tiebreak);
    expect(hand.cards).toHaveLength(5);
  });

  it('does not treat a wrap-around (Q-K-A-2-3) as a straight', () => {
    expect(evaluateFive(parseCards('Qs Kd Ah 2c 3d')).category).toBe('high_card');
    expect(evaluateFive(parseCards('Kh Ah 2h 3h 4h')).category).toBe('flush');
  });

  it('prefers the higher straight when 6 consecutive ranks are available', () => {
    expect(best('As 2d 3c 4h 5s 6d Kc').tiebreak).toEqual([6]);
  });

  it('picks the best two pair out of three pairs', () => {
    expect(best('Ah Ad Kc Ks Qd Qc 2h').tiebreak).toEqual([14, 13, 12]);
  });

  it('picks the best full house out of two trips', () => {
    expect(best('Ah Ad Ac Ks Kd Kc 2h').tiebreak).toEqual([14, 13]);
  });

  it('rejects the wrong number of cards', () => {
    expect(() => evaluateFive(parseCards('As Ks'))).toThrow(RangeError);
    expect(() => bestHand(parseCards('As Ks Qs Js'))).toThrow(RangeError);
  });
});

describe('compareHands: ties and kickers', () => {
  const cmp = (a: string, b: string) => compareHands(best(a), best(b));

  it.each([
    // [winner, loser, why]
    ['As Ad Kc 7s 4d 3c 2h', 'Ah Ac Qc 7d 4s 3d 2c', 'pair of aces, K kicker beats Q kicker'],
    ['Kh Kd 9c 8s 6d 3c 2h', 'Kc Ks 9h 8d 5s 3d 2c', 'pair of kings decided on the 3rd kicker'],
    ['Ah Ad 5c 5s Kd 3c 2h', 'As Ac 5d 5h Qd 3s 2c', 'same two pair, kicker K beats Q'],
    ['6h 5d 4c 3s 2d Kc Kh', 'As 2d 3c 4h 5s Qd Qc', '6-high straight beats the wheel'],
    ['Ah 9h 7h 5h 3h Kd Kc', 'Kh Qh Jh Th 8h Ad Ac', 'ace-high flush beats king-high flush'],
    ['3h 3d 3c 2s 2d Kc Qh', '2h 2c 2s As Ad Kd Qc', 'full house compares trips first'],
    ['9h 9d 9c 9s Kd 2c 3h', '9h 9d 9c 9s Qd 2c 3h', 'quads decided by kicker'],
  ])('%s beats %s (%s)', (winner, loser) => {
    expect(cmp(winner, loser)).toBe(1);
    expect(cmp(loser, winner)).toBe(-1);
  });

  it.each([
    ['As Kd 9c 8s 6d 4c 2h', 'Ac Kh 9d 8h 6s 3d 2c', 'same 5 best cards: 7th card does not play'],
    ['Ah Kh Qh Jh Th 2c 3d', 'As Ks Qs Js Ts 4c 5d', 'royal flushes in different suits'],
    ['2c 3d Ah Ad Kc Ks Qh', '4s 5h Ac As Kd Kh Qd', 'board plays: A A K K Q for both'],
  ])('%s ties %s (%s)', (a, b) => {
    expect(cmp(a, b)).toBe(0);
  });
});

describe('evaluateFive: exhaustive over all 2,598,960 five-card hands', () => {
  it('matches the known category frequencies and has 7,462 distinct strengths', () => {
    const deck = createStandardDeck();
    const counts: Record<string, number> = {};
    const values = new Set<number>();
    const hand: Card[] = new Array<Card>(5);
    for (let a = 0; a < 48; a++)
      for (let b = a + 1; b < 49; b++)
        for (let c = b + 1; c < 50; c++)
          for (let d = c + 1; d < 51; d++)
            for (let e = d + 1; e < 52; e++) {
              hand[0] = deck[a]!;
              hand[1] = deck[b]!;
              hand[2] = deck[c]!;
              hand[3] = deck[d]!;
              hand[4] = deck[e]!;
              const result = evaluateFive(hand);
              counts[result.category] = (counts[result.category] ?? 0) + 1;
              values.add(result.value);
            }
    expect(counts).toEqual({
      straight_flush: 40,
      four_of_a_kind: 624,
      full_house: 3744,
      flush: 5108,
      straight: 10200,
      three_of_a_kind: 54912,
      two_pair: 123552,
      pair: 1098240,
      high_card: 1302540,
    });
    expect(values.size).toBe(7462);
  }, 60_000);
});

describe('bestHand: properties', () => {
  const sevenCards = fc
    .string()
    .map((seed) => shuffleDeck(createSeededRng(seed), createStandardDeck()).slice(0, 7));

  it('does not depend on card order', () => {
    fc.assert(
      fc.property(sevenCards, (cards) => {
        expect(bestHand(cards).value).toBe(bestHand(cards.slice().reverse()).value);
      }),
    );
  });

  it('is at least as strong as any 5-card subset', () => {
    fc.assert(
      fc.property(
        sevenCards,
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 6 }),
        (cards, i, j) => {
          const subset = cards.filter((_, k) => k !== i && k !== j).slice(0, 5);
          expect(bestHand(cards).value).toBeGreaterThanOrEqual(evaluateFive(subset).value);
        },
      ),
    );
  });

  it('does not depend on suits beyond flushes (suit relabeling keeps the value)', () => {
    const relabel: Record<string, Card['suit']> = { s: 'h', h: 'd', d: 'c', c: 's' };
    fc.assert(
      fc.property(sevenCards, (cards) => {
        const relabeled = cards.map((c) => ({
          ...c,
          suit: relabel[c.suit]!,
          id: `${c.id[0]}${relabel[c.suit]}`,
        }));
        expect(bestHand(relabeled).value).toBe(bestHand(cards).value);
      }),
    );
  });
});
