import type { Rng } from './rng';

/**
 * Seeded PRNG for the roguelike (ADR 0003).
 *
 * Algorithm: **sfc32** (Chris Doty-Humphrey's Small Fast Counting generator, 128-bit state),
 * seeded by hashing the seed text with **cyrb128**. sfc32 passes PractRand and BigCrush, uses only
 * 32-bit integer ops (identical results on Hermes, V8 and JSC), and its whole state is 4 uint32,
 * so it is stored in the run state and survives save/load.
 *
 * Not cryptographic: the Mesa mode uses a CSPRNG implemented in apps/server.
 */
export type SeededRngState = readonly [number, number, number, number];

/** cyrb128 string hash → 128 bits. Hashes UTF-16 code units, so it is platform independent. */
export function hashSeed(text: string): SeededRngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Discarded outputs after seeding, so similar seeds diverge quickly. */
const WARM_UP_ROUNDS = 15;

export class SeededRng implements Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: SeededRngState) {
    [this.a, this.b, this.c, this.d] = state;
  }

  /**
   * Generator for `seed`. `stream` names an independent sub-stream (e.g. "deck", "shop"), so
   * consuming randomness in one purpose never shifts the sequence of another.
   */
  static fromSeed(seed: string, stream = ''): SeededRng {
    const rng = new SeededRng(hashSeed(`${stream}\u0000${seed}`));
    for (let i = 0; i < WARM_UP_ROUNDS; i++) rng.nextUint32();
    return rng;
  }

  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Serializable snapshot; `new SeededRng(state)` continues the exact same sequence. */
  getState(): SeededRngState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }
}

export function createSeededRng(seed: string, stream = ''): SeededRng {
  return SeededRng.fromSeed(seed, stream);
}
