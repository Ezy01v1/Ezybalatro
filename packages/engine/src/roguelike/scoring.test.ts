import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTENT,
  SeededRng,
  HAND_CATEGORIES,
  parseCards,
  scoreHand,
  type HandCategory,
  type JokerDefinition,
  type JokerInstance,
  type RunCard,
  type RunContent,
  type Rng,
  type ScoreInput,
} from '../index';

const LEVEL_1 = Object.fromEntries(HAND_CATEGORIES.map((h) => [h, 1])) as Record<
  HandCategory,
  number
>;
const joker = (jokerId: string, n = 1, state: Record<string, number> = {}): JokerInstance => ({
  instanceId: `j${n}`,
  jokerId,
  state,
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

describe('scoreHand: base and cards', () => {
  it('pair: base chips + chips of the 2 scoring cards, times base mult', () => {
    // pair 12 chips × 2 mult; 7 + 7 chips; the 2 does not score.
    const result = scoreHand(input('7h 2c 7d'));
    expect(result.handType).toBe('pair');
    expect(result.scoringCards.map((c) => c.id)).toEqual(['7h', '7d']);
    expect([result.chips, result.mult, result.score]).toEqual([26, 2, 52]);
  });

  it('hand level adds chips and mult per level', () => {
    // level 3 pair: 12 + 2×15 = 42 chips, 2 + 2×1 = 4 mult; +14 chips from cards.
    const result = scoreHand(input('7h 7d', { handLevels: { ...LEVEL_1, pair: 3 } }));
    expect([result.chips, result.mult, result.score]).toEqual([56, 4, 224]);
  });

  it('face cards are 10 chips and aces 11', () => {
    // straight 36 chips × 4: 10 + J10 + Q10 + K10 + A11 = 51.
    expect(scoreHand(input('Tc Jd Qh Ks As')).chips).toBe(87);
  });
});

describe('scoreHand: jokers', () => {
  it('jokers apply left to right: +mult before ×mult differs from the reverse', () => {
    const emberThenPrism = scoreHand(
      input('7h 7d', { jokers: [joker('ember', 1), joker('prism', 2)] }),
    );
    const prismThenEmber = scoreHand(
      input('7h 7d', { jokers: [joker('prism', 1), joker('ember', 2)] }),
    );
    expect(emberThenPrism.mult).toBe(9); // (2 + 4) × 1.5
    expect(prismThenEmber.mult).toBe(7); // 2 × 1.5 + 4
    expect(emberThenPrism.score).toBe(234);
    expect(prismThenEmber.score).toBe(182);
  });

  it('suit joker triggers per scoring heart, right after that card', () => {
    const result = scoreHand(input('7h 7d 2h', { jokers: [joker('stubborn_heart')] }));
    expect(
      result.steps.map(
        (s) => s.source.kind + (s.source.kind === 'card' ? `:${s.source.cardId}` : ''),
      ),
    ).toEqual(['base', 'card:7h', 'joker', 'card:7d']);
    expect(result.mult).toBe(5); // the 2h is not a scoring card
  });

  it('scaling joker counts hands played since bought', () => {
    const first = scoreHand(input('7h 7d', { jokers: [joker('veteran', 1, { hands: 0 })] }));
    expect(first.mult).toBe(3);
    expect(first.jokers[0]!.state).toEqual({ hands: 1 });
    const second = scoreHand(input('7h 7d', { jokers: first.jokers }));
    expect(second.mult).toBe(4);
    expect(second.jokers[0]!.state).toEqual({ hands: 2 });
  });

  it('economy joker does nothing while scoring (it pays at round end)', () => {
    const result = scoreHand(input('7h 7d', { jokers: [joker('piggy_bank')] }));
    expect([result.score, result.money, result.steps.length]).toEqual([52, 0, 3]);
  });

  it('unknown jokers (content removed) are ignored', () => {
    expect(scoreHand(input('7h 7d', { jokers: [joker('gone')] })).score).toBe(52);
  });
});

describe('scoreHand: pipeline order with held cards and enhancements', () => {
  it('scoring cards → held cards → jokers', () => {
    const anchor: RunCard = { ...parseCards('Kc')[0]!, enhancement: 'anchor' };
    const reinforced: RunCard = { ...parseCards('7h')[0]!, enhancement: 'reinforced' };
    const result = scoreHand({
      ...input('7d'),
      played: [reinforced, parseCards('7d')[0]!],
      held: [anchor],
      jokers: [joker('ember')],
    });
    // chips: 12 + 7 + 25 (reinforced) + 7 = 51. mult: 2 × 1.5 (anchor, held) + 4 (ember) = 7.
    expect([result.chips, result.mult, result.score]).toEqual([51, 7, 357]);
    expect(result.steps.map((s) => s.source.kind)).toEqual([
      'base',
      'card',
      'enhancement',
      'card',
      'enhancement',
      'joker',
    ]);
  });

  it('new jokers with any hook plug in without touching the pipeline', () => {
    const custom: JokerDefinition[] = [
      {
        id: 'per_held',
        rarity: 'common',
        cost: 1,
        onCardHeld: (_s, _c, card) => ({ chips: card.rank }),
      },
      { id: 'tip', rarity: 'common', cost: 1, onCardScored: () => ({ money: 1 }) },
    ];
    const content = { ...DEFAULT_CONTENT, jokers: [...DEFAULT_CONTENT.jokers, ...custom] };
    const result = scoreHand(
      {
        ...input('7h 7d'),
        held: parseCards('2c 3c'),
        jokers: [joker('per_held', 1), joker('tip', 2)],
      },
      content,
    );
    expect(result.chips).toBe(26 + 2 + 3);
    expect(result.money).toBe(2);
  });

  it('debuffed cards count for the hand type but add nothing', () => {
    const result = scoreHand(
      input('7s 7d', { isDebuffed: (c) => c.suit === 's', jokers: [joker('stubborn_heart')] }),
    );
    expect(result.handType).toBe('pair');
    expect([result.chips, result.score]).toEqual([19, 38]);
  });
});

describe('scoreHand: card enhancements', () => {
  const withEnhancement = (cards: string, enhancement: string): RunCard[] =>
    parseCards(cards).map((c) => ({ ...c, enhancement }));
  const stepKinds = (result: ReturnType<typeof scoreHand>) =>
    result.steps.map((s) =>
      s.source.kind === 'enhancement' ? `enhancement:${s.source.cardId}` : s.source.kind,
    );

  it('charged adds +4 mult once per scoring card that has it', () => {
    const [seven, other] = parseCards('7h 7d');
    const one = scoreHand({
      ...input('7h 7d'),
      played: [{ ...seven!, enhancement: 'charged' }, other!],
    });
    // chips 12 + 7 + 7 = 26; mult 2 + 4 = 6.
    expect([one.chips, one.mult, one.score]).toEqual([26, 6, 156]);
    expect(stepKinds(one)).toEqual(['base', 'card', 'enhancement:7h', 'card']);

    const both = scoreHand({ ...input('7h 7d'), played: withEnhancement('7h 7d', 'charged') });
    expect([both.mult, both.score]).toEqual([10, 260]);
  });

  it('charged on a card that does not score does nothing', () => {
    const played = [...parseCards('7h 7d'), { ...parseCards('2c')[0]!, enhancement: 'charged' }];
    const result = scoreHand({ ...input('7h 7d'), played });
    expect([result.mult, result.score]).toEqual([2, 52]);
  });

  it('gilded adds $2 to the money earned while scoring, without changing the score', () => {
    const result = scoreHand({
      ...input('7h 7d'),
      played: withEnhancement('7h 7d', 'gilded').slice(0, 1).concat(parseCards('7d')),
    });
    expect(result.money).toBe(2);
    expect(result.score).toBe(52);
    expect(result.steps.find((s) => s.source.kind === 'enhancement')!.effect).toEqual({ money: 2 });
  });

  it('heavy adds +30 chips while it stays in hand', () => {
    const result = scoreHand({ ...input('7h 7d'), held: withEnhancement('Kc', 'heavy') });
    // chips 26 + 30 = 56; mult 2.
    expect([result.chips, result.mult, result.score]).toEqual([56, 2, 112]);
    expect(stepKinds(result)).toEqual(['base', 'card', 'card', 'enhancement:Kc']);
    expect(result.steps.at(-1)!.source).toMatchObject({ kind: 'enhancement', held: true });
  });

  it('heavy does nothing when the card is played', () => {
    const played = [{ ...parseCards('7h')[0]!, enhancement: 'heavy' }, parseCards('7d')[0]!];
    const result = scoreHand({ ...input('7h 7d'), played });
    expect([result.chips, result.score]).toEqual([26, 52]);
    expect(stepKinds(result)).toEqual(['base', 'card', 'card']);
  });

  it('volatile multiplies mult by 1.3 after the +mult already added', () => {
    const [first, second] = parseCards('7h 7d');
    const result = scoreHand({
      ...input('7h 7d'),
      played: [
        { ...first!, enhancement: 'charged' },
        { ...second!, enhancement: 'volatile' },
      ],
    });
    // (2 + 4) × 1.3 = 7.8; 26 × 7.8 = 202.8.
    expect(result.mult).toBeCloseTo(7.8);
    expect(result.score).toBe(202);
    expect(result.steps.at(-1)!.effect).toEqual({ xMult: 1.3 });
  });

  it('volatile on its own: ×1.3 over the base mult', () => {
    const result = scoreHand({
      ...input('7h 7d'),
      played: withEnhancement('7h', 'volatile').concat(parseCards('7d')),
    });
    expect(result.mult).toBeCloseTo(2.6);
    expect(result.score).toBe(67);
  });
});

/** A joker that rolls `roll(n, d)` once per hand and adds +100 mult when it hits. */
const roller = (id: string, n: number, d: number): JokerDefinition => ({
  id,
  rarity: 'common',
  cost: 1,
  onHandScored: (_self, ctx) => (ctx.roll(n, d) ? { mult: 100 } : undefined),
});
const withJokers = (...jokers: JokerDefinition[]): RunContent => ({ ...DEFAULT_CONTENT, jokers });
/** An Rng that counts how many numbers were drawn from it. */
const countingRng = () => {
  const rng = SeededRng.fromSeed('count', 'score');
  const counter = { calls: 0 };
  const wrapped: Rng = {
    nextUint32: () => {
      counter.calls += 1;
      return rng.nextUint32();
    },
  };
  return { rng: wrapped, counter };
};

describe('scoreHand: luck', () => {
  const content = withJokers(roller('flip', 1, 2));

  it('is reproducible: the same fresh generator gives the same score and steps', () => {
    const run = () =>
      scoreHand(
        input('7h 7d', { jokers: [joker('flip')], rng: SeededRng.fromSeed('x', 'score') }),
        content,
      );
    expect(run()).toEqual(run());
  });

  it('both outcomes happen across seeds, and the result follows the generator', () => {
    const results = Array.from({ length: 40 }, (_, i) =>
      scoreHand(
        input('7h 7d', { jokers: [joker('flip')], rng: SeededRng.fromSeed(`s${i}`, 'score') }),
        content,
      ),
    );
    expect(new Set(results.map((r) => r.mult)).size).toBe(2);
    for (const [i, r] of results.entries()) {
      const hit = SeededRng.fromSeed(`s${i}`, 'score').nextUint32() % 2 === 0;
      expect(r.mult === 102).toBe(hit);
    }
  });

  it('without a generator roll is always false and never throws', () => {
    const result = scoreHand(input('7h 7d', { jokers: [joker('flip')] }), content);
    expect(result.mult).toBe(2);
    expect(result.steps.length).toBe(3);
  });

  it.each([
    [0, 4],
    [-1, 4],
    [1, 0],
    [1, -2],
  ])('roll(%i, %i) is false and draws nothing', (n, d) => {
    const { rng, counter } = countingRng();
    const result = scoreHand(
      input('7h 7d', { jokers: [joker('r')], rng }),
      withJokers(roller('r', n, d)),
    );
    expect(result.mult).toBe(2);
    expect(counter.calls).toBe(0);
  });

  it.each([
    [4, 4],
    [5, 4],
  ])('roll(%i, %i) is true and draws nothing', (n, d) => {
    const { rng, counter } = countingRng();
    const result = scoreHand(
      input('7h 7d', { jokers: [joker('r')], rng }),
      withJokers(roller('r', n, d)),
    );
    expect(result.mult).toBe(102);
    expect(counter.calls).toBe(0);
  });

  it('rolls follow evaluation order: left joker first, then the next', () => {
    const two = withJokers(roller('a', 1, 2), roller('b', 1, 2));
    const manual = SeededRng.fromSeed('order', 'score');
    const firstHit = manual.nextUint32() % 2 === 0;
    const secondHit = manual.nextUint32() % 2 === 0;
    const result = scoreHand(
      input('7h 7d', {
        jokers: [joker('a', 1), joker('b', 2)],
        rng: SeededRng.fromSeed('order', 'score'),
      }),
      two,
    );
    expect(result.mult).toBe(2 + (firstHit ? 100 : 0) + (secondHit ? 100 : 0));
  });
});
