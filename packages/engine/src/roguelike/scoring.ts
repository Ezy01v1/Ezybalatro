import { nextInt, type Rng } from '../rng';
import { evaluatePlayedHand } from '../hands/played-hand';
import type { HandCategory } from '../hands/hand-category';
import { CARD_CHIPS, DEFAULT_CONTENT } from './content';
import type { Effect, HandContext, JokerEffect, JokerInstance, RunCard, RunContent } from './types';

/** Extra passes one scoring card can get, however many jokers and enhancements ask for them. */
export const MAX_RETRIGGERS = 3;

export type ScoreSource =
  | { readonly kind: 'base'; readonly handType: HandCategory; readonly level: number }
  /** `repeat` is present only on the extra passes (1 = the first repeat). */
  | { readonly kind: 'card'; readonly cardId: string; readonly repeat?: number }
  | {
      readonly kind: 'enhancement';
      readonly cardId: string;
      readonly enhancement: string;
      readonly held: boolean;
      readonly repeat?: number;
    }
  | {
      readonly kind: 'joker';
      readonly instanceId: string;
      readonly jokerId: string;
      readonly hook: 'onCardScored' | 'onCardHeld' | 'onHandScored' | 'edition';
      readonly cardId?: string;
      readonly repeat?: number;
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
  /** Hands left in the round after this one. */
  readonly handsLeft?: number;
  readonly discardsLeft?: number;
  readonly money: number;
  /** Boss rule: debuffed cards still count for the hand type but add nothing and trigger nothing. */
  readonly isDebuffed?: (card: RunCard) => boolean;
  /** Generator for luck (`ctx.roll`). Without one, every roll fails. */
  readonly rng?: Rng;
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

/** Chips and mult of a hand type at a level (level 1 = base values). */
export function handBase(
  handType: HandCategory,
  level: number,
  content: RunContent = DEFAULT_CONTENT,
): { chips: number; mult: number } {
  const stats = content.handTypes[handType];
  return {
    chips: stats.chips + stats.chipsPerLevel * (level - 1),
    mult: stats.mult + stats.multPerLevel * (level - 1),
  };
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
  const debuffed = input.isDebuffed ?? (() => false);
  const jokerDefs = new Map(content.jokers.map((j) => [j.id, j]));
  const enhancementDefs = new Map(content.enhancements.map((e) => [e.id, e]));
  const editionDefs = new Map(content.editions.map((e) => [e.id, e]));
  const jokers = input.jokers.map((j) => ({ ...j }));

  const base = handBase(handType, level, content);
  let chips = base.chips;
  let mult = base.mult;
  let money = 0;
  const steps: ScoreStep[] = [
    { source: { kind: 'base', handType, level }, effect: { chips, mult }, chips, mult },
  ];

  const roll = (n: number, d: number): boolean => {
    if (!(n > 0) || !Number.isInteger(d) || d <= 0 || !input.rng) return false;
    if (n >= d) return true;
    return nextInt(input.rng, d) < n;
  };
  const ctx = (): HandContext => ({
    handType,
    played: input.played,
    scoring: scoringCards,
    held: input.held,
    jokers,
    handsPlayed: input.handsPlayed,
    handsLeft: input.handsLeft ?? 0,
    discardsLeft: input.discardsLeft ?? 0,
    money: input.money + money,
    roll,
  });
  const apply = (source: ScoreSource, effect: Effect | undefined) => {
    if (!effect) return;
    chips += effect.chips ?? 0;
    mult += effect.mult ?? 0;
    mult *= effect.xMult ?? 1;
    money += effect.money ?? 0;
    steps.push({ source, effect, chips, mult });
  };
  const runJokers = (
    hook: 'onCardScored' | 'onCardHeld' | 'onHandScored',
    card?: RunCard,
    repeat = 0,
  ) => {
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
          ...(repeat > 0 ? { repeat } : {}),
        },
        effect,
      );
      // A joker's edition is its own bonus, once per hand, right after its effect.
      const edition =
        hook === 'onHandScored' && joker.edition ? editionDefs.get(joker.edition) : undefined;
      if (edition?.effect) {
        apply(
          { kind: 'joker', instanceId: joker.instanceId, jokerId: joker.jokerId, hook: 'edition' },
          edition.effect,
        );
      }
    });
  };

  /** Extra passes asked by the jokers (left to right) and the card's enhancement, capped. */
  const extraPasses = (card: RunCard): number => {
    const count = (n: number | undefined) =>
      n === undefined || Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n));
    let total = 0;
    for (const joker of jokers) {
      total += count(jokerDefs.get(joker.jokerId)?.retriggers?.(joker, ctx(), card));
    }
    const own = card.enhancement ? enhancementDefs.get(card.enhancement) : undefined;
    total += count(own?.retriggers?.(card, ctx()));
    return Math.min(MAX_RETRIGGERS, total);
  };

  for (const card of scoringCards) {
    if (debuffed(card)) continue;
    const enhancement = card.enhancement ? enhancementDefs.get(card.enhancement) : undefined;
    const passes = 1 + extraPasses(card);
    for (let repeat = 0; repeat < passes; repeat++) {
      const marked = repeat > 0 ? { repeat } : {};
      apply({ kind: 'card', cardId: card.id, ...marked }, { chips: CARD_CHIPS[card.rank] });
      if (enhancement?.onScored) {
        apply(
          {
            kind: 'enhancement',
            cardId: card.id,
            enhancement: enhancement.id,
            held: false,
            ...marked,
          },
          enhancement.onScored(card, ctx()),
        );
      }
      runJokers('onCardScored', card, repeat);
    }
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
