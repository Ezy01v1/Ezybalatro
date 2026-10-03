import { evaluatePlayedHand } from '../hands/played-hand';
import type { HandCategory } from '../hands/hand-category';
import { CARD_CHIPS, DEFAULT_CONTENT } from './content';
import type { Effect, HandContext, JokerEffect, JokerInstance, RunCard, RunContent } from './types';

export type ScoreSource =
  | { readonly kind: 'base'; readonly handType: HandCategory; readonly level: number }
  | { readonly kind: 'card'; readonly cardId: string }
  | {
      readonly kind: 'enhancement';
      readonly cardId: string;
      readonly enhancement: string;
      readonly held: boolean;
    }
  | {
      readonly kind: 'joker';
      readonly instanceId: string;
      readonly jokerId: string;
      readonly hook: 'onCardScored' | 'onCardHeld' | 'onHandScored';
      readonly cardId?: string;
    };

/** One change to the tally, in order. The UI replays these to animate the score. */
export interface ScoreStep {
  readonly source: ScoreSource;
  readonly effect: Effect;
  readonly chips: number;
  readonly mult: number;
}

export interface ScoreInput {
  /** In play order (left to right). */
  readonly played: readonly RunCard[];
  /** Cards left in hand, in hand order. */
  readonly held: readonly RunCard[];
  /** In slot order (left to right). */
  readonly jokers: readonly JokerInstance[];
  readonly handLevels: Readonly<Record<HandCategory, number>>;
  /** Hands played in the run, this one included. */
  readonly handsPlayed: number;
  readonly money: number;
  /** Boss rule: debuffed cards still count for the hand type but add nothing and trigger nothing. */
  readonly isDebuffed?: (card: RunCard) => boolean;
}

export interface ScoreResult {
  readonly handType: HandCategory;
  readonly scoringCards: readonly RunCard[];
  readonly chips: number;
  readonly mult: number;
  /** floor(chips × mult). */
  readonly score: number;
  readonly steps: readonly ScoreStep[];
  /** Jokers with their state after this hand. */
  readonly jokers: readonly JokerInstance[];
  /** Money earned by effects during scoring. */
  readonly money: number;
}

/**
 * Scores a played hand. Fixed order:
 *
 * 1. Base chips and mult of the hand type at its level.
 * 2. Each scoring card, left to right: its chips, then its enhancement (`onScored`), then every
 *    joker's `onCardScored`, jokers left to right.
 * 3. Each card left in hand, in hand order: its enhancement (`onHeld`), then every joker's `onCardHeld`.
 * 4. Every joker's `onHandScored`, left to right.
 *
 * Within one effect: chips are added first, then +mult, then ×mult.
 */
export function scoreHand(input: ScoreInput, content: RunContent = DEFAULT_CONTENT): ScoreResult {
  const { type: handType, scoringCards } = evaluatePlayedHand(input.played);
  const level = input.handLevels[handType];
  const stats = content.handTypes[handType];
  const debuffed = input.isDebuffed ?? (() => false);
  const jokerDefs = new Map(content.jokers.map((j) => [j.id, j]));
  const enhancementDefs = new Map(content.enhancements.map((e) => [e.id, e]));
  const jokers = input.jokers.map((j) => ({ ...j }));

  let chips = stats.chips + stats.chipsPerLevel * (level - 1);
  let mult = stats.mult + stats.multPerLevel * (level - 1);
  let money = 0;
  const steps: ScoreStep[] = [
    { source: { kind: 'base', handType, level }, effect: { chips, mult }, chips, mult },
  ];

  const ctx = (): HandContext => ({
    handType,
    played: input.played,
    scoring: scoringCards,
    held: input.held,
    jokers,
    handsPlayed: input.handsPlayed,
    money: input.money + money,
  });
  const apply = (source: ScoreSource, effect: Effect | undefined) => {
    if (!effect) return;
    chips += effect.chips ?? 0;
    mult += effect.mult ?? 0;
    mult *= effect.xMult ?? 1;
    money += effect.money ?? 0;
    steps.push({ source, effect, chips, mult });
  };
  const runJokers = (hook: 'onCardScored' | 'onCardHeld' | 'onHandScored', card?: RunCard) => {
    jokers.forEach((joker, i) => {
      const def = jokerDefs.get(joker.jokerId);
      if (!def) return;
      const effect: JokerEffect | undefined =
        hook === 'onHandScored'
          ? def.onHandScored?.(joker, ctx())
          : hook === 'onCardScored'
            ? def.onCardScored?.(joker, ctx(), card!)
            : def.onCardHeld?.(joker, ctx(), card!);
      if (effect?.state) jokers[i] = { ...joker, state: effect.state };
      apply(
        {
          kind: 'joker',
          instanceId: joker.instanceId,
          jokerId: joker.jokerId,
          hook,
          ...(card ? { cardId: card.id } : {}),
        },
        effect,
      );
    });
  };

  for (const card of scoringCards) {
    if (debuffed(card)) continue;
    apply({ kind: 'card', cardId: card.id }, { chips: CARD_CHIPS[card.rank] });
    const enhancement = card.enhancement ? enhancementDefs.get(card.enhancement) : undefined;
    if (enhancement?.onScored) {
      apply(
        { kind: 'enhancement', cardId: card.id, enhancement: enhancement.id, held: false },
        enhancement.onScored(card, ctx()),
      );
    }
    runJokers('onCardScored', card);
  }
  for (const card of input.held) {
    if (debuffed(card)) continue;
    const enhancement = card.enhancement ? enhancementDefs.get(card.enhancement) : undefined;
    if (enhancement?.onHeld) {
      apply(
        { kind: 'enhancement', cardId: card.id, enhancement: enhancement.id, held: true },
        enhancement.onHeld(card, ctx()),
      );
    }
    runJokers('onCardHeld', card);
  }
  runJokers('onHandScored');

  return {
    handType,
    scoringCards,
    chips,
    mult,
    score: Math.floor(chips * mult),
    steps,
    jokers,
    money,
  };
}
