import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createSeededRng,
  createStandardDeck,
  hasUniqueIds,
  isCompleteStandardDeck,
  makeCard,
  nextInt,
  parseCard,
  parseCards,
  SeededRng,
  shuffleDeck,
} from './index';

describe('cards', () => {
  it('builds a standard 52-card deck with unique ids', () => {
    const deck = createStandardDeck();
    expect(deck).toHaveLength(52);
    expect(hasUniqueIds(deck)).toBe(true);
    expect(isCompleteStandardDeck(deck)).toBe(true);
  });

  it('parses card notation', () => {
    expect(parseCard('As')).toEqual({ id: 'As', rank: 14, suit: 's' });
    expect(parseCard('10H')).toEqual({ id: 'Th', rank: 10, suit: 'h' });
    expect(parseCards('2c  td\tKd').map((c) => c.id)).toEqual(['2c', 'Td', 'Kd']);
    expect(() => parseCard('1s')).toThrow(RangeError);
    expect(() => parseCard('Ax')).toThrow(RangeError);
  });

  it('rejects decks that are not exactly the standard 52', () => {
    const deck = createStandardDeck();
    expect(isCompleteStandardDeck(deck.slice(1))).toBe(false);
    expect(isCompleteStandardDeck([...deck.slice(1), deck[1]!])).toBe(false);
    expect(
      isCompleteStandardDeck([...deck.slice(1), { id: 'Ax', rank: 14, suit: 'x' as never }]),
    ).toBe(false);
    expect(isCompleteStandardDeck([...deck.slice(1), { ...makeCard(14, 's'), id: 'fake' }])).toBe(
      false,
    );
  });

  it('has no duplicates and keeps all 52 cards after any shuffle', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const shuffled = shuffleDeck(createSeededRng(seed), createStandardDeck());
        expect(isCompleteStandardDeck(shuffled)).toBe(true);
      }),
    );
  });
});

describe('SeededRng (sfc32 + cyrb128)', () => {
  it('produces the same sequence for the same seed', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (seed, stream) => {
        const a = createSeededRng(seed, stream);
        const b = createSeededRng(seed, stream);
        for (let i = 0; i < 50; i++) expect(a.nextUint32()).toBe(b.nextUint32());
      }),
    );
  });

  it('produces the same shuffle for the same seed', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const deck = createStandardDeck();
        expect(shuffleDeck(createSeededRng(seed), deck)).toEqual(
          shuffleDeck(createSeededRng(seed), deck),
        );
      }),
    );
  });

  it('is pinned to known outputs (changing the algorithm breaks saved runs)', () => {
    const rng = createSeededRng('naipes');
    const first = [rng.nextUint32(), rng.nextUint32(), rng.nextUint32()];
    expect(first).toMatchInlineSnapshot(`
      [
        3947882952,
        3386117727,
        3789042494,
      ]
    `);
  });

  it('resumes the exact sequence from a saved state', () => {
    const rng = createSeededRng('save-load');
    for (let i = 0; i < 10; i++) rng.nextUint32();
    const resumed = new SeededRng(rng.getState());
    for (let i = 0; i < 100; i++) expect(resumed.nextUint32()).toBe(rng.nextUint32());
  });

  it('gives independent sub-streams per purpose', () => {
    const deck = createSeededRng('seed', 'deck');
    const shop = createSeededRng('seed', 'shop');
    const a = Array.from({ length: 8 }, () => deck.nextUint32());
    const b = Array.from({ length: 8 }, () => shop.nextUint32());
    expect(a).not.toEqual(b);
  });

  it('diverges for seeds that differ in one character', () => {
    expect(createSeededRng('seed-1').nextUint32()).not.toBe(createSeededRng('seed-2').nextUint32());
  });

  it('is roughly uniform (chi-square over 52 buckets)', () => {
    const rng = createSeededRng('uniformity');
    const buckets = new Array<number>(52).fill(0);
    const draws = 52_000;
    for (let i = 0; i < draws; i++) buckets[nextInt(rng, 52)]!++;
    const expected = draws / 52;
    const chi2 = buckets.reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
    // 51 degrees of freedom: p = 0.001 critical value ≈ 87.97.
    expect(chi2).toBeLessThan(88);
  });
});
