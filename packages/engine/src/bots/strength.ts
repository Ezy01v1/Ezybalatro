import { RANKS, SUITS, type Card, type Rank } from '../cards';
import { categoryStrength } from '../hands/hand-category';
import { bestHand } from '../hands/poker-hand';
import { groupByRank } from '../hands/rank-groups';

/** Strength heuristics for bots. Both return a value in [0, 1]; bigger is better. */

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function chenHighCardScore(rank: Rank): number {
  if (rank === 14) return 10;
  if (rank === 13) return 8;
  if (rank === 12) return 7;
  if (rank === 11) return 6;
  return rank / 2;
}

function chenGapPenalty(gap: number): number {
  if (gap <= 0) return 0;
  if (gap === 1) return -1;
  if (gap === 2) return -2;
  if (gap === 3) return -4;
  return -5;
}

function chenScore(high: Rank, low: Rank, suited: boolean): number {
  const pair = high === low;
  let score = chenHighCardScore(high);
  if (pair) score = Math.max(5, score * 2);
  if (suited) score += 2;
  if (!pair) {
    const gap = high - low - 1;
    score += chenGapPenalty(gap);
    if (gap <= 1 && high < 12) score += 1;
  }
  return Math.ceil(score);
}

function classKey(high: Rank, low: Rank, suited: boolean): string {
  const label = (rank: Rank) => (rank === 10 ? 'T' : rank > 10 ? 'JQKA'[rank - 11] : String(rank));
  if (high === low) return `${label(high)}${label(low)}`;
  return `${label(high)}${label(low)}${suited ? 's' : 'o'}`;
}

/** The 169 starting-hand classes ('AA', 'AKs', 'AKo', ...) mapped to their normalised Chen score. */
const PREFLOP_STRENGTH: ReadonlyMap<string, number> = (() => {
  const table = new Map<string, number>();
  for (const high of RANKS) {
    for (const low of RANKS) {
      if (low > high) continue;
      const variants = high === low ? [false] : [true, false];
      for (const suited of variants) {
        table.set(classKey(high, low, suited), clamp01((chenScore(high, low, suited) + 1) / 21));
      }
    }
  }
  return table;
})();

export function preflopStrength(holeCards: readonly [Card, Card]): number {
  const [a, b] = holeCards;
  const high = Math.max(a.rank, b.rank) as Rank;
  const low = Math.min(a.rank, b.rank) as Rank;
  return PREFLOP_STRENGTH.get(classKey(high, low, a.suit === b.suit)) ?? 0;
}

/** Strength of a made hand, indexed by category strength (high card ... straight flush). */
const MADE_STRENGTH = [0.15, 0.45, 0.65, 0.75, 0.82, 0.87, 0.93, 0.98, 1.0] as const;
const FLUSH_DRAW_BONUS = 0.15;
const OPEN_ENDED_DRAW_BONUS = 0.12;
const STRAIGHT = 4;

/** Category of the board by itself; with fewer than 5 cards it is derived from rank groups. */
function boardCategory(board: readonly Card[]): number {
  if (board.length >= 5) return categoryStrength(bestHand(board).category);
  const sizes = groupByRank(board).map((group) => group.cards.length);
  const largest = sizes[0] ?? 0;
  if (largest >= 4) return 7;
  if (largest === 3) return 3;
  if (largest === 2) return sizes[1] === 2 ? 2 : 1;
  return 0;
}

function hasFlushDraw(holeCards: readonly Card[], all: readonly Card[]): boolean {
  return SUITS.some(
    (suit) =>
      all.filter((c) => c.suit === suit).length === 4 &&
      holeCards.some((c) => c.suit === suit),
  );
}

function hasOpenEndedDraw(holeCards: readonly Card[], all: readonly Card[]): boolean {
  const present = new Set<number>();
  for (const card of all) {
    present.add(card.rank);
    if (card.rank === 14) present.add(1);
  }
  const own = new Set<number>();
  for (const card of holeCards) {
    own.add(card.rank);
    if (card.rank === 14) own.add(1);
  }
  // Four consecutive ranks r..r+3 that can be completed on both ends (r - 1 and r + 4 within 1..14).
  for (let start = 2; start + 4 <= 14; start++) {
    const run = [start, start + 1, start + 2, start + 3];
    if (run.every((rank) => present.has(rank)) && run.some((rank) => own.has(rank))) return true;
  }
  return false;
}

export function postflopStrength(holeCards: readonly [Card, Card], board: readonly Card[]): number {
  const all = [...holeCards, ...board];
  const madeCategory = categoryStrength(bestHand(all).category);
  let strength =
    madeCategory > boardCategory(board) ? (MADE_STRENGTH[madeCategory] ?? 0.15) : MADE_STRENGTH[0];

  if (board.length < 5 && madeCategory < STRAIGHT) {
    if (hasFlushDraw(holeCards, all)) strength += FLUSH_DRAW_BONUS;
    if (hasOpenEndedDraw(holeCards, all)) strength += OPEN_ENDED_DRAW_BONUS;
  }
  return clamp01(strength);
}
