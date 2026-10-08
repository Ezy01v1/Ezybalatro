import { isCompleteStandardDeck } from '@naipes/engine';
import { CryptoDeckSource } from './crypto-deck-source';

describe('CryptoDeckSource', () => {
  it('returns a complete 52-card deck', () => {
    const deck = new CryptoDeckSource().nextDeck();
    expect(deck).toHaveLength(52);
    expect(isCompleteStandardDeck(deck)).toBe(true);
  });

  it('first card is uniform (chi-square, loose threshold)', () => {
    const source = new CryptoDeckSource();
    // 51 degrees of freedom: mean 51, SD ~10.1. Threshold 120 is ~7 SD above the mean, so a false
    // failure is negligible, while a visibly biased shuffle still lands far above it.
    const runs = 20_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < runs; i++) {
      const c = source.nextDeck()[0]!;
      const key = JSON.stringify(c);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(52);
    const expected = runs / 52;
    let chi = 0;
    for (const n of counts.values()) chi += (n - expected) ** 2 / expected;
    expect(chi).toBeLessThan(120);
  });
});
