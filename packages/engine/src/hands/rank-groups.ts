import type { Card, Rank } from '../cards';

export interface RankGroup {
  readonly rank: Rank;
  readonly cards: readonly Card[];
}

/** Cards grouped by rank, largest group first, ties broken by higher rank. */
export function groupByRank(cards: readonly Card[]): RankGroup[] {
  const byRank = new Map<Rank, Card[]>();
  for (const card of cards) {
    const group = byRank.get(card.rank);
    if (group) group.push(card);
    else byRank.set(card.rank, [card]);
  }
  return [...byRank.entries()]
    .map(([rank, group]) => ({ rank, cards: group }))
    .sort((a, b) => b.cards.length - a.cards.length || b.rank - a.rank);
}

export function isFlush(cards: readonly Card[]): boolean {
  return cards.length === 5 && cards.every((c) => c.suit === cards[0]?.suit);
}

/**
 * High card of the straight formed by exactly 5 cards, or null.
 * A-2-3-4-5 (the wheel) is a 5-high straight; wrap-arounds like Q-K-A-2-3 are not straights.
 */
export function straightHigh(cards: readonly Card[]): Rank | null {
  if (cards.length !== 5) return null;
  const ranks = [...new Set(cards.map((c) => c.rank))].sort((a, b) => b - a);
  if (ranks.length !== 5) return null;
  const [top, , , , bottom] = ranks as [Rank, Rank, Rank, Rank, Rank];
  if (top - bottom === 4) return top;
  if (top === 14 && ranks[1] === 5 && bottom === 2) return 5;
  return null;
}
