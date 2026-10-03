import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTENT,
  HAND_CATEGORIES,
  parseCards,
  scoreHand,
  type HandCategory,
  type JokerDefinition,
  type JokerInstance,
  type RunCard,
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
