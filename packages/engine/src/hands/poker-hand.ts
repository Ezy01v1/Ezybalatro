import type { Card, Rank } from '../cards';
import { categoryStrength, type HandCategory } from './hand-category';
import { groupByRank, isFlush, straightHigh } from './rank-groups';

export interface EvaluatedHand {
  readonly category: HandCategory;
  /** Ranks that break ties within the category, most significant first (category ranks, then kickers). */
  readonly tiebreak: readonly Rank[];
  /** Totally ordered strength: higher wins, equal means an exact tie (split pot). */
  readonly value: number;
  /** The 5 cards that make the hand. */
  readonly cards: readonly Card[];
}

const BASE = 15;

function encode(category: HandCategory, tiebreak: readonly Rank[]): number {
  let value = categoryStrength(category);
  for (let i = 0; i < 5; i++) value = value * BASE + (tiebreak[i] ?? 0);
  return value;
}

/** Evaluates exactly 5 cards. */
export function evaluateFive(cards: readonly Card[]): EvaluatedHand {
  if (cards.length !== 5) throw new RangeError(`evaluateFive needs 5 cards, got ${cards.length}`);
  const groups = groupByRank(cards);
  const flush = isFlush(cards);
  const high = straightHigh(cards);
  const sizes = groups.map((g) => g.cards.length).join('');
  const groupRanks = groups.map((g) => g.rank);

  let category: HandCategory;
  let tiebreak: Rank[];
  if (high !== null && flush) [category, tiebreak] = ['straight_flush', [high]];
  else if (sizes === '41') [category, tiebreak] = ['four_of_a_kind', groupRanks];
  else if (sizes === '32') [category, tiebreak] = ['full_house', groupRanks];
  else if (flush) [category, tiebreak] = ['flush', groupRanks];
  else if (high !== null) [category, tiebreak] = ['straight', [high]];
  else if (sizes === '311') [category, tiebreak] = ['three_of_a_kind', groupRanks];
  else if (sizes === '221') [category, tiebreak] = ['two_pair', groupRanks];
  else if (sizes === '2111') [category, tiebreak] = ['pair', groupRanks];
  else [category, tiebreak] = ['high_card', groupRanks];

  return { category, tiebreak, value: encode(category, tiebreak), cards: [...cards] };
}

/** Best 5-card hand out of 5 to 7 cards (Hold'em: 2 hole cards + up to 5 on the board). */
export function bestHand(cards: readonly Card[]): EvaluatedHand {
  const n = cards.length;
  if (n < 5 || n > 7) throw new RangeError(`bestHand needs 5 to 7 cards, got ${n}`);
  let best: EvaluatedHand | undefined;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const hand = evaluateFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (!best || hand.value > best.value) best = hand;
          }
  return best!;
}

/** > 0 if `a` wins, < 0 if `b` wins, 0 for an exact tie. */
export function compareHands(
  a: Pick<EvaluatedHand, 'value'>,
  b: Pick<EvaluatedHand, 'value'>,
): number {
  return Math.sign(a.value - b.value);
}
