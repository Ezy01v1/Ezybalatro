import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nextInt, shuffle, type Rng } from './index';

/**
 * Deterministic test RNG that cycles through a fixed list of uint32 values. A 0 is appended so the
 * cycle always has a value that rejection sampling accepts (a cycle made only of rejected values,
 * e.g. [0xffffffff] with max 3, would loop forever).
 */
function sequenceRng(values: readonly number[]): Rng {
  const cycle = [...values, 0];
  let i = 0;
  return { nextUint32: () => cycle[i++ % cycle.length]! };
}

describe('nextInt', () => {
  it('stays within [0, max)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 0xffff_ffff }), { minLength: 1 }),
        fc.integer({ min: 1, max: 1000 }),
        (values, max) => {
          const n = nextInt(sequenceRng(values), max);
          return n >= 0 && n < max;
        },
      ),
    );
  });

  it('rejects values in the biased zone and draws again', () => {
    // 2^32 % 3 = 1, so 0xffffffff is rejected and the next value (0) is used.
    expect(nextInt(sequenceRng([0xffff_ffff]), 3)).toBe(0);
  });

  it('rejects invalid bounds', () => {
    expect(() => nextInt(sequenceRng([1]), 0)).toThrow(RangeError);
  });
});

describe('shuffle', () => {
  it('is a permutation of the input and does not mutate it', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer()),
        fc.array(fc.nat({ max: 0xffff_ffff }), { minLength: 1 }),
        (items, values) => {
          const copy = items.slice();
          const result = shuffle(sequenceRng(values), items);
          expect(items).toEqual(copy);
          expect(result.slice().sort((a, b) => a - b)).toEqual(copy.sort((a, b) => a - b));
        },
      ),
    );
  });

  it('is deterministic for the same RNG sequence', () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    expect(shuffle(sequenceRng([7, 99, 12345]), items)).toEqual(
      shuffle(sequenceRng([7, 99, 12345]), items),
    );
  });
});
