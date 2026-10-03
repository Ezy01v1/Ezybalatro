import type { Rank } from '../cards';
import type {
  BossDefinition,
  EnhancementDefinition,
  HandTypeStats,
  JokerDefinition,
  RunContent,
} from './types';
import type { HandCategory } from '../hands/hand-category';

/**
 * Roguelike content as data. Values are original and meant to be tuned with the balance simulation.
 * Display names and descriptions do not live here (UI texts are centralized in the app); the
 * comments show the proposed es-419 names.
 */

/** Chips each card adds when it scores. */
export const CARD_CHIPS: Readonly<Record<Rank, number>> = {
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  11: 10,
  12: 10,
  13: 10,
  14: 11,
};

export const HAND_TYPES: Readonly<Record<HandCategory, HandTypeStats>> = {
  high_card: { chips: 5, mult: 1, chipsPerLevel: 10, multPerLevel: 1 },
  pair: { chips: 12, mult: 2, chipsPerLevel: 15, multPerLevel: 1 },
  two_pair: { chips: 24, mult: 2, chipsPerLevel: 20, multPerLevel: 1 },
  three_of_a_kind: { chips: 32, mult: 3, chipsPerLevel: 20, multPerLevel: 2 },
  straight: { chips: 36, mult: 4, chipsPerLevel: 30, multPerLevel: 2 },
  flush: { chips: 40, mult: 4, chipsPerLevel: 20, multPerLevel: 2 },
  full_house: { chips: 48, mult: 4, chipsPerLevel: 25, multPerLevel: 2 },
  four_of_a_kind: { chips: 70, mult: 7, chipsPerLevel: 30, multPerLevel: 3 },
  straight_flush: { chips: 110, mult: 8, chipsPerLevel: 40, multPerLevel: 4 },
};

/** The 5 sample jokers. Each covers one kind of effect. */
export const JOKERS: readonly JokerDefinition[] = [
  // "Brasa": +4 mult. (flat +mult)
  { id: 'ember', rarity: 'common', cost: 4, onHandScored: () => ({ mult: 4 }) },
  // "Prisma": ×1.5 mult. (×mult)
  { id: 'prism', rarity: 'uncommon', cost: 6, onHandScored: () => ({ xMult: 1.5 }) },
  // "Corazón Terco": +3 mult for each scoring heart. (suit condition)
  {
    id: 'stubborn_heart',
    rarity: 'common',
    cost: 5,
    onCardScored: (_self, _ctx, card) => (card.suit === 'h' ? { mult: 3 } : undefined),
  },
  // "Veterano": +1 mult for every hand played since it was bought, this one included. (scaling)
  {
    id: 'veteran',
    rarity: 'uncommon',
    cost: 6,
    initialState: { hands: 0 },
    onHandScored: (self) => {
      const hands = (self.state.hands ?? 0) + 1;
      return { mult: hands, state: { hands } };
    },
  },
  // "Alcancía": +$3 at the end of every round won. (economy)
  { id: 'piggy_bank', rarity: 'common', cost: 4, onRoundEnd: () => ({ money: 3 }) },
];

/** Sample card enhancements (cards get them through consumables in a later phase). */
export const ENHANCEMENTS: readonly EnhancementDefinition[] = [
  // "Reforzada": +25 chips when it scores.
  { id: 'reinforced', onScored: () => ({ chips: 25 }) },
  // "Ancla": ×1.5 mult while it stays in hand.
  { id: 'anchor', onHeld: () => ({ xMult: 1.5 }) },
];

export const BOSSES: readonly BossDefinition[] = [
  // "La Niebla": spades do not score.
  { id: 'fog', debuffSuit: 's' },
  // "La Sequía": no discards.
  { id: 'drought', discardsDelta: -99 },
  // "El Reloj": one hand less.
  { id: 'clock', handsDelta: -1 },
];

export const DEFAULT_CONTENT: RunContent = {
  jokers: JOKERS,
  enhancements: ENHANCEMENTS,
  bosses: BOSSES,
  handTypes: HAND_TYPES,
};
