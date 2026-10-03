import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nextInt, shuffle, type Rng } from './index';

/** Deterministic test RNG that cycles through a fixed list of uint32 values. */
function sequenceRng(values: readonly number[]): Rng {
  let i = 0;
  return { nextUint32: () => values[i++ % values.length] ?? 0 };
}

describe('nextInt', () => {
  it('stays within [0, max)', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 0xffff_ffff }), { minLength: 1 }), fc.integer({ min: 1, max: 1000 }), (values, max) => {
        const n = nextInt(sequenceRng(values), max);
        return n >= 0 && n < max;
      }),
    );
  });

  it('rejects invalid bounds', () => {
    expect(() => nextInt(sequenceRng([1]), 0)).toThrow(RangeError);
  });
});

describe('shuffle', () => {
  it('is a permutation of the input and does not mutate it', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.array(fc.nat({ max: 0xffff_ffff }), { minLength: 1 }), (items, values) => {
        const copy = items.slice();
        const result = shuffle(sequenceRng(values), items);
        expect(items).toEqual(copy);
        expect(result.slice().sort((a, b) => a - b)).toEqual(copy.sort((a, b) => a - b));
      }),
    );
  });

  it('is deterministic for the same RNG sequence', () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    expect(shuffle(sequenceRng([7, 99, 12345]), items)).toEqual(shuffle(sequenceRng([7, 99, 12345]), items));
  });
});
