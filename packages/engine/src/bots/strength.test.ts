import { describe, expect, it } from 'vitest';
import { createStandardDeck, parseCards, type Card } from '../index';
import { postflopStrength, preflopStrength } from './strength';

const hole = (text: string) => parseCards(text) as [Card, Card];
const board = parseCards;

describe('preflopStrength', () => {
  it('AA is 1 and the ordering is sane', () => {
    expect(preflopStrength(hole('As Ah'))).toBe(1);
    const order = ['As Ah', 'Ks Kh', 'As Ks', 'As Kd', '2s 2h', '7s 2d'].map((h) =>
      preflopStrength(hole(h)),
    );
    expect(order).toEqual([...order].sort((a, b) => b - a));
    expect(new Set(order).size).toBe(order.length);
  });

  it('is in [0, 1] for every two-card combination', () => {
    const deck = createStandardDeck();
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        const value = preflopStrength([deck[i] as Card, deck[j] as Card]);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('does not depend on the order of the hole cards', () => {
    expect(preflopStrength(hole('Ks Qh'))).toBe(preflopStrength(hole('Qh Ks')));
  });
});

describe('postflopStrength', () => {
  it('a set beats an unpaired high card', () => {
    expect(postflopStrength(hole('As Ah'), board('Ad 7c 2s'))).toBeGreaterThan(
      postflopStrength(hole('Kc Qd'), board('Ah 7c 2s')),
    );
  });

  it('a pair on the board alone is not your hand', () => {
    expect(postflopStrength(hole('Ac Kd'), board('7c 7d 2s'))).toBe(0.15);
  });

  it('flush draw adds 0.15 on flop and turn, nothing on the river', () => {
    expect(postflopStrength(hole('Ah 5h'), board('Kh 9h 2c'))).toBeCloseTo(0.3);
    expect(postflopStrength(hole('Ah 5h'), board('Kh 9h 2c 3d'))).toBeCloseTo(0.3);
    expect(postflopStrength(hole('Ah 5h'), board('Kh 9h 2c 3d Js'))).toBe(0.15);
  });

  it('four suited cards on the board without a suited hole card is not a draw', () => {
    expect(postflopStrength(hole('Ac Kd'), board('2h 5h 9h Jh'))).toBe(0.15);
  });

  it('open-ended straight draw adds 0.12', () => {
    expect(postflopStrength(hole('9c 8d'), board('7h 6s 2c'))).toBeCloseTo(0.27);
  });

  it('gutshots and ace-edge runs are not open-ended', () => {
    expect(postflopStrength(hole('9c 7d'), board('6h 5s 2c'))).toBe(0.15);
    expect(postflopStrength(hole('Ac 2d'), board('3h 4s Kc'))).toBe(0.15);
    expect(postflopStrength(hole('Jc Qd'), board('Kh As 2c'))).toBe(0.15);
  });

  it('draws never apply to made straights or better', () => {
    expect(postflopStrength(hole('9h 8h'), board('7h 6h 5h'))).toBe(1);
    expect(postflopStrength(hole('9c 8d'), board('7h 6s 5c'))).toBe(0.82);
  });
});
