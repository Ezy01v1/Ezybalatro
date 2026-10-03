import type { Card } from '../cards';
import type { HandCategory } from './hand-category';
import { groupByRank, isFlush, straightHigh } from './rank-groups';

export interface PlayedHand<T extends Card = Card> {
  readonly type: HandCategory;
  /** Cards that score, in the order they were played (left to right). */
  readonly scoringCards: readonly T[];
}

/**
 * Roguelike: classifies 1 to 5 played cards and picks the cards that score.
 * Straights and flushes need all 5 cards. Only the cards forming the hand score:
 * a pair plus three unrelated cards scores the 2 paired cards; a high card scores the highest card.
 */
export function evaluatePlayedHand<T extends Card>(cards: readonly T[]): PlayedHand<T> {
  if (cards.length < 1 || cards.length > 5) {
    throw new RangeError(`A played hand has 1 to 5 cards, got ${cards.length}`);
  }
  const groups = groupByRank(cards);
  const sizes = groups.map((g) => g.cards.length);
  const flush = isFlush(cards);
  const straight = straightHigh(cards) !== null;
  const inPlayOrder = (picked: readonly Card[]): T[] => cards.filter((c) => picked.includes(c));
  const firstGroups = (count: number) =>
    inPlayOrder(groups.slice(0, count).flatMap((g) => g.cards));

  if (straight && flush) return { type: 'straight_flush', scoringCards: [...cards] };
  // A 5-of-a-kind (only possible with a modified deck) scores as four of a kind with its first 4 cards.
  if (sizes[0]! >= 4) return { type: 'four_of_a_kind', scoringCards: firstGroups(1).slice(0, 4) };
  if (sizes[0] === 3 && sizes[1] === 2) return { type: 'full_house', scoringCards: [...cards] };
  if (flush) return { type: 'flush', scoringCards: [...cards] };
  if (straight) return { type: 'straight', scoringCards: [...cards] };
  if (sizes[0] === 3) return { type: 'three_of_a_kind', scoringCards: firstGroups(1) };
  if (sizes[0] === 2 && sizes[1] === 2) return { type: 'two_pair', scoringCards: firstGroups(2) };
  if (sizes[0] === 2) return { type: 'pair', scoringCards: firstGroups(1) };
  return { type: 'high_card', scoringCards: firstGroups(1) };
}
