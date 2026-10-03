import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createSeededRng,
  createStandardDeck,
  evaluatePlayedHand,
  parseCards,
  shuffleDeck,
} from '../index';

const played = (text: string) => {
  const result = evaluatePlayedHand(parseCards(text));
  return { type: result.type, scoring: result.scoringCards.map((c) => c.id).join(' ') };
};

describe('evaluatePlayedHand (roguelike, 1 to 5 cards)', () => {
  it.each([
    ['Kd', 'high_card', 'Kd'],
    ['2c 9h 5d', 'high_card', '9h'],
    ['7h 7d', 'pair', '7h 7d'],
    ['2c 7h Ks 7d 9c', 'pair', '7h 7d'],
    ['Js 4c Jd 4h', 'two_pair', 'Js 4c Jd 4h'],
    ['4c Js 2d Jd 4h', 'two_pair', '4c Js Jd 4h'],
    ['8s 8h 8d', 'three_of_a_kind', '8s 8h 8d'],
    ['8s 2c 8h 3d 8d', 'three_of_a_kind', '8s 8h 8d'],
    ['5h 9c 6d 7s 8h', 'straight', '5h 9c 6d 7s 8h'],
    ['Ah 2c 3d 4s 5h', 'straight', 'Ah 2c 3d 4s 5h'],
    ['Qs Kd Ah 2c 3d', 'high_card', 'Ah'],
    ['2d 9d Kd 4d Jd', 'flush', '2d 9d Kd 4d Jd'],
    ['Tc Th 3s 3d Td', 'full_house', 'Tc Th 3s 3d Td'],
    ['Ac 2d Ah As Ad', 'four_of_a_kind', 'Ac Ah As Ad'],
    ['Ac Ah As Ad', 'four_of_a_kind', 'Ac Ah As Ad'],
    ['9s Ts Js Qs Ks', 'straight_flush', '9s Ts Js Qs Ks'],
    ['5c 4c 3c 2c Ac', 'straight_flush', '5c 4c 3c 2c Ac'],
  ] as const)('%s → %s scoring [%s]', (cards, type, scoring) => {
    expect(played(cards)).toEqual({ type, scoring });
  });

  it('needs all 5 cards for straights and flushes', () => {
    expect(played('5h 6c 7d 8s').type).toBe('high_card');
    expect(played('2d 9d Kd 4d').type).toBe('high_card');
  });

  it('rejects 0 or more than 5 cards', () => {
    expect(() => evaluatePlayedHand([])).toThrow(RangeError);
    expect(() => evaluatePlayedHand(parseCards('2c 3c 4c 5c 6c 7c'))).toThrow(RangeError);
  });

  it('scoring cards are a subset of the played cards, in play order', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 5 }), (seed, n) => {
        const cards = shuffleDeck(createSeededRng(seed), createStandardDeck()).slice(0, n);
        const { scoringCards } = evaluatePlayedHand(cards);
        expect(scoringCards.length).toBeGreaterThan(0);
        expect(scoringCards).toEqual(cards.filter((c) => scoringCards.includes(c)));
      }),
    );
  });
});
