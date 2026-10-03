/** Poker hand categories, weakest first. The index is the category strength. */
export const HAND_CATEGORIES = [
  'high_card',
  'pair',
  'two_pair',
  'three_of_a_kind',
  'straight',
  'flush',
  'full_house',
  'four_of_a_kind',
  'straight_flush',
] as const;

export type HandCategory = (typeof HAND_CATEGORIES)[number];

export function categoryStrength(category: HandCategory): number {
  return HAND_CATEGORIES.indexOf(category);
}
