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

const isFace = (rank: Rank) => rank >= 11 && rank <= 13;
const hasPair = (type: string) =>
  ['pair', 'two_pair', 'three_of_a_kind', 'full_house', 'four_of_a_kind'].includes(type);

/**
 * MVP jokers (20). The first 5 are the reference set for each kind of effect: flat +mult, ×mult,
 * suit condition, scaling and economy. Comments: proposed es-419 name and effect.
 */
export const JOKERS: readonly JokerDefinition[] = [
  // "Brasa": +4 mult.
  { id: 'ember', rarity: 'common', cost: 4, onHandScored: () => ({ mult: 4 }) },
  // "Prisma": ×1.5 mult.
  { id: 'prism', rarity: 'uncommon', cost: 6, onHandScored: () => ({ xMult: 1.5 }) },
  // "Corazón Terco": +3 mult for each scoring heart.
  {
    id: 'stubborn_heart',
    rarity: 'common',
    cost: 5,
    onCardScored: (_self, _ctx, card) => (card.suit === 'h' ? { mult: 3 } : undefined),
  },
  // "Veterano": +1 mult for every hand played since it was bought, this one included.
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
  // "Alcancía": +$3 at the end of every round won.
  { id: 'piggy_bank', rarity: 'common', cost: 4, onRoundEnd: () => ({ money: 3 }) },
  // "Hoja de Pica": +25 chips for each scoring spade.
  {
    id: 'spade_leaf',
    rarity: 'common',
    cost: 5,
    onCardScored: (_self, _ctx, card) => (card.suit === 's' ? { chips: 25 } : undefined),
  },
  // "Diamante en Bruto": +$1 for each scoring diamond.
  {
    id: 'rough_diamond',
    rarity: 'common',
    cost: 5,
    onCardScored: (_self, _ctx, card) => (card.suit === 'd' ? { money: 1 } : undefined),
  },
  // "Trébol Viejo": +3 mult for each scoring club.
  {
    id: 'old_clover',
    rarity: 'common',
    cost: 5,
    onCardScored: (_self, _ctx, card) => (card.suit === 'c' ? { mult: 3 } : undefined),
  },
  // "Pareja Feliz": +8 mult if the hand contains a pair.
  {
    id: 'happy_couple',
    rarity: 'common',
    cost: 4,
    onHandScored: (_self, ctx) => (hasPair(ctx.handType) ? { mult: 8 } : undefined),
  },
  // "Escalera de Caracol": +80 chips if the hand is a straight.
  {
    id: 'spiral_stair',
    rarity: 'common',
    cost: 5,
    onHandScored: (_self, ctx) =>
      ctx.handType === 'straight' || ctx.handType === 'straight_flush' ? { chips: 80 } : undefined,
  },
  // "Abanico": +60 chips if the hand is a flush.
  {
    id: 'fan',
    rarity: 'common',
    cost: 5,
    onHandScored: (_self, ctx) =>
      ctx.handType === 'flush' || ctx.handType === 'straight_flush' ? { chips: 60 } : undefined,
  },
  // "Trío Dinámico": ×2 mult with three of a kind, full house or four of a kind.
  {
    id: 'dynamic_trio',
    rarity: 'uncommon',
    cost: 7,
    onHandScored: (_self, ctx) =>
      ['three_of_a_kind', 'full_house', 'four_of_a_kind'].includes(ctx.handType)
        ? { xMult: 2 }
        : undefined,
  },
  // "Minimalista": +12 mult when you play 3 cards or fewer.
  {
    id: 'minimalist',
    rarity: 'uncommon',
    cost: 6,
    onHandScored: (_self, ctx) => (ctx.played.length <= 3 ? { mult: 12 } : undefined),
  },
  // "Mano Firme": +2 mult for each card left in hand.
  { id: 'steady_hand', rarity: 'common', cost: 5, onCardHeld: () => ({ mult: 2 }) },
  // "Descarte Sabio": gains +4 chips for every card discarded; adds them to each hand.
  {
    id: 'wise_discard',
    rarity: 'uncommon',
    cost: 6,
    initialState: { chips: 0 },
    onDiscard: (self, ctx) => ({
      state: { chips: (self.state.chips ?? 0) + 4 * ctx.discarded.length },
    }),
    onHandScored: (self) =>
      (self.state.chips ?? 0) > 0 ? { chips: self.state.chips ?? 0 } : undefined,
  },
  // "Ahorrista": +1 mult for every $5 you hold.
  {
    id: 'saver',
    rarity: 'uncommon',
    cost: 6,
    onHandScored: (_self, ctx) =>
      ctx.money >= 5 ? { mult: Math.floor(ctx.money / 5) } : undefined,
  },
  // "Último Aliento": ×3 mult on the last hand of the round.
  {
    id: 'last_breath',
    rarity: 'rare',
    cost: 8,
    onHandScored: (_self, ctx) => (ctx.handsLeft === 0 ? { xMult: 3 } : undefined),
  },
  // "As Bajo la Manga": each scoring ace gives +20 chips and +4 mult.
  {
    id: 'ace_sleeve',
    rarity: 'uncommon',
    cost: 6,
    onCardScored: (_self, _ctx, card) => (card.rank === 14 ? { chips: 20, mult: 4 } : undefined),
  },
  // "Figurín": each scoring face card (J, Q, K) gives +3 mult.
  {
    id: 'figurine',
    rarity: 'common',
    cost: 5,
    onCardScored: (_self, _ctx, card) => (isFace(card.rank) ? { mult: 3 } : undefined),
  },
  // "Propina": +$1 for each hand left when you beat a blind.
  {
    id: 'tip_jar',
    rarity: 'common',
    cost: 4,
    onRoundEnd: (_self, ctx) => (ctx.handsLeft > 0 ? { money: ctx.handsLeft } : undefined),
  },
];

/** Sample card enhancements (cards get them through consumables in a later phase). */
export const ENHANCEMENTS: readonly EnhancementDefinition[] = [
  // "Reforzada": +25 chips when it scores.
  { id: 'reinforced', onScored: () => ({ chips: 25 }) },
  // "Ancla": ×1.5 mult while it stays in hand.
  { id: 'anchor', onHeld: () => ({ xMult: 1.5 }) },
];

/** The 5 MVP bosses. Each hinders a different strategy. */
export const BOSSES: readonly BossDefinition[] = [
  // "La Niebla": spades do not score.
  { id: 'fog', debuffSuit: 's' },
  // "La Sequía": no discards.
  { id: 'drought', discardsDelta: -99 },
  // "El Reloj": one hand less (and one extra discard to dig for it).
  { id: 'clock', handsDelta: -1, discardsDelta: 1 },
  // "La Prensa": one card less in hand.
  { id: 'press', handSizeDelta: -1 },
  // "La Máscara": face cards (J, Q, K) do not score.
  { id: 'mask', debuffRanks: [11, 12, 13] },
];

export const DEFAULT_CONTENT: RunContent = {
  jokers: JOKERS,
  enhancements: ENHANCEMENTS,
  bosses: BOSSES,
  handTypes: HAND_TYPES,
};
