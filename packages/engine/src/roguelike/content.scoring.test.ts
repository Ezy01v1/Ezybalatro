import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTENT,
  HAND_CATEGORIES,
  MAX_RETRIGGERS,
  SeededRng,
  parseCards,
  scoreHand,
  type HandCategory,
  type JokerInstance,
  type RunCard,
  type ScoreInput,
} from '../index';
import { nextInt } from '../rng';

const LEVEL_1 = Object.fromEntries(HAND_CATEGORIES.map((h) => [h, 1])) as Record<
  HandCategory,
  number
>;
const joker = (jokerId: string, n = 1): JokerInstance => ({
  instanceId: `j${n}`,
  jokerId,
  state: {},
});
const input = (played: string, extra: Partial<ScoreInput> = {}): ScoreInput => ({
  played: parseCards(played),
  held: [],
  jokers: [],
  handLevels: LEVEL_1,
  handsPlayed: 1,
  money: 0,
  ...extra,
});
const rngFor = (seed: string) => SeededRng.fromSeed(seed, 'score');
/** The cards that appear in more than one step, by id. */
const repeatedIds = (steps: ReturnType<typeof scoreHand>['steps']) =>
  steps.flatMap((s) =>
    s.source.kind === 'card' && s.source.repeat !== undefined ? [s.source.cardId] : [],
  );

describe('retrigger jokers', () => {
  const FULL_HOUSE = 'Ks Kh 9c 9d 9s';

  it('Eco de la Corte repeats the face cards that score, and only them', () => {
    const result = scoreHand(input(FULL_HOUSE, { jokers: [joker('court_echo')] }));
    expect(repeatedIds(result.steps).sort()).toEqual(['Kh', 'Ks']);
    const plain = scoreHand(input(FULL_HOUSE));
    expect(result.chips).toBe(plain.chips + 20);
  });

  it('Primer Bis repeats the first scoring card only', () => {
    const result = scoreHand(input(FULL_HOUSE, { jokers: [joker('first_encore')] }));
    expect(repeatedIds(result.steps)).toEqual([result.scoringCards[0]!.id]);
  });

  it('Último Bis repeats the last scoring card only', () => {
    const result = scoreHand(input(FULL_HOUSE, { jokers: [joker('last_encore')] }));
    expect(repeatedIds(result.steps)).toEqual([result.scoringCards.at(-1)!.id]);
  });

  it('Eco del Corazón repeats scoring hearts only', () => {
    const result = scoreHand(input('Ks Kh 9c 9d 9h', { jokers: [joker('heart_echo')] }));
    expect(repeatedIds(result.steps).sort()).toEqual(['9h', 'Kh']);
  });

  it('echo jokers never go past the cap, even all together', () => {
    const jokers = ['court_echo', 'first_encore', 'last_encore', 'heart_echo'].map((id, i) =>
      joker(id, i + 1),
    );
    const result = scoreHand(input('Kh Kd 9c 9d 9h', { jokers }));
    for (const card of result.scoringCards) {
      const passes = result.steps.filter(
        (s) => s.source.kind === 'card' && s.source.cardId === card.id,
      );
      expect(passes.length).toBeLessThanOrEqual(1 + MAX_RETRIGGERS);
    }
  });
});

describe('luck content', () => {
  const PAIR = '7h 7d';

  it('Dado Cargado: 1 in 8 for ×2 mult, following the score stream', () => {
    const seeds = Array.from({ length: 60 }, (_, i) => `die-${i}`);
    let hits = 0;
    for (const seed of seeds) {
      const expected = nextInt(rngFor(seed), 8) === 0;
      const result = scoreHand(input(PAIR, { jokers: [joker('loaded_die')], rng: rngFor(seed) }));
      expect(result.mult).toBe(expected ? 4 : 2);
      if (expected) hits++;
    }
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(seeds.length);
  });

  it('Moneda de la Suerte: 1 in 4 for $4', () => {
    for (let i = 0; i < 40; i++) {
      const seed = `coin-${i}`;
      const expected = nextInt(rngFor(seed), 4) === 0;
      const result = scoreHand(input(PAIR, { jokers: [joker('lucky_coin')], rng: rngFor(seed) }));
      expect(result.money).toBe(expected ? 4 : 0);
    }
  });

  it('Chispa rolls once per scoring card, in order', () => {
    for (let i = 0; i < 20; i++) {
      const seed = `spark-${i}`;
      const sim = rngFor(seed);
      const hits = [0, 1].filter(() => nextInt(sim, 3) === 0).length;
      const result = scoreHand(input(PAIR, { jokers: [joker('spark')], rng: rngFor(seed) }));
      expect(result.mult).toBe(2 + 3 * hits);
    }
  });

  it('the Moneda enhancement: 1 in 2 for +20 mult when its card scores', () => {
    const [first, second] = parseCards(PAIR) as [RunCard, RunCard];
    for (let i = 0; i < 30; i++) {
      const seed = `enh-${i}`;
      const expected = nextInt(rngFor(seed), 2) === 0;
      const result = scoreHand({
        ...input(PAIR, { rng: rngFor(seed) }),
        played: [{ ...first, enhancement: 'coin' }, second],
      });
      expect(result.mult).toBe(expected ? 22 : 2);
    }
  });

  it('is reproducible: the same seed gives the same steps', () => {
    const run = () =>
      scoreHand(
        input('Ks Kh 9c 9d 9s', {
          jokers: [joker('spark', 1), joker('loaded_die', 2), joker('court_echo', 3)],
          rng: rngFor('same'),
        }),
      );
    expect(run()).toEqual(run());
  });

  it('without a generator the luck content never fires', () => {
    const result = scoreHand(
      input(PAIR, { jokers: [joker('spark', 1), joker('loaded_die', 2), joker('lucky_coin', 3)] }),
    );
    expect([result.mult, result.money]).toEqual([2, 0]);
  });
});

describe('new content is registered', () => {
  it('has 27 jokers with unique ids and 7 enhancements', () => {
    const ids = DEFAULT_CONTENT.jokers.map((j) => j.id);
    expect(ids).toHaveLength(27);
    expect(new Set(ids).size).toBe(27);
    expect(DEFAULT_CONTENT.enhancements.map((e) => e.id)).toContain('coin');
    expect(DEFAULT_CONTENT.enhancements).toHaveLength(7);
  });
});
