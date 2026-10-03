/**
 * Injected source of randomness. The engine never creates randomness itself:
 * the roguelike passes a seeded PRNG, the server passes a CSPRNG-backed one (ADR 0003).
 */
export interface Rng {
  /** Unsigned 32-bit integer in [0, 2^32). */
  nextUint32(): number;
}

const UINT32_RANGE = 0x1_0000_0000;

/** Unbiased integer in [0, maxExclusive) using rejection sampling. */
export function nextInt(rng: Rng, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
    throw new RangeError(`maxExclusive must be an integer in (0, 2^32], got ${maxExclusive}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  let value = rng.nextUint32();
  while (value >= limit) {
    value = rng.nextUint32();
  }
  return value % maxExclusive;
}

/** Fisher-Yates shuffle. Returns a new array; the input is not mutated. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const tmp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = tmp;
  }
  return result;
}
