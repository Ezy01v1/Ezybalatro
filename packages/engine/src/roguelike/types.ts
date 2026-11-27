import type { Card, Rank, Suit } from '../cards';
import type { HandCategory } from '../hands/hand-category';

/** A card in a run's deck. Same rank/suit/id as a standard card, plus optional modifiers. */
export interface RunCard extends Card {
  readonly enhancement?: string;
}

export interface JokerInstance {
  /** Unique within the run ("j1", "j2"…). */
  readonly instanceId: string;
  readonly jokerId: string;
  /** Per-instance counters (e.g. hands played since bought). Numbers only, so it serializes. */
  readonly state: Readonly<Record<string, number>>;
}

/** What a joker or an enhancement adds. Applied in this order: chips, then +mult, then ×mult. */
export interface Effect {
  readonly chips?: number;
  readonly mult?: number;
  readonly xMult?: number;
  readonly money?: number;
}

export interface JokerEffect extends Effect {
  /** Replaces the instance state. */
  readonly state?: Readonly<Record<string, number>>;
}

export interface HandContext {
  readonly handType: HandCategory;
  readonly played: readonly RunCard[];
  readonly scoring: readonly RunCard[];
  readonly held: readonly RunCard[];
  readonly jokers: readonly JokerInstance[];
  /** Hands played in the run, this one included. */
  readonly handsPlayed: number;
  /** Hands left in this round after this one (0 = last hand). */
  readonly handsLeft: number;
  readonly discardsLeft: number;
  readonly money: number;
  /**
   * Luck: true with probability n / d, drawn from the run's score stream in evaluation order.
   * Always false when `n <= 0`, `d` is not a positive integer, or the hand is scored without a
   * generator; always true (drawing nothing) when `n >= d`.
   */
  roll(n: number, d: number): boolean;
}

export interface DiscardContext {
  readonly discarded: readonly RunCard[];
  readonly money: number;
}

export interface RoundEndContext {
  readonly blind: BlindKind;
  readonly handsLeft: number;
  readonly discardsLeft: number;
  readonly money: number;
}

export interface ShopEnterContext {
  readonly money: number;
}

/**
 * A joker is data plus optional hooks. The pipeline calls whatever hooks a joker defines, so a new
 * joker is a new entry in the content list; the pipeline never changes. Hooks must be pure.
 */
export interface JokerDefinition {
  readonly id: string;
  readonly rarity: 'common' | 'uncommon' | 'rare';
  /** Shop price. Sells for half (rounded down, at least 1). */
  readonly cost: number;
  readonly initialState?: Readonly<Record<string, number>>;
  /** Once per scoring card, right after that card adds its chips. */
  onCardScored?(self: JokerInstance, ctx: HandContext, card: RunCard): JokerEffect | undefined;
  /** Once per card left in hand. */
  onCardHeld?(self: JokerInstance, ctx: HandContext, card: RunCard): JokerEffect | undefined;
  /** Once per hand, after all cards. */
  onHandScored?(self: JokerInstance, ctx: HandContext): JokerEffect | undefined;
  onDiscard?(self: JokerInstance, ctx: DiscardContext): JokerEffect | undefined;
  onRoundEnd?(self: JokerInstance, ctx: RoundEndContext): JokerEffect | undefined;
  onShopEnter?(self: JokerInstance, ctx: ShopEnterContext): JokerEffect | undefined;
}

/** Card modifier (e.g. extra chips when scored). Same idea as jokers, but attached to a card. */
export interface EnhancementDefinition {
  readonly id: string;
  onScored?(card: RunCard, ctx: HandContext): Effect | undefined;
  onHeld?(card: RunCard, ctx: HandContext): Effect | undefined;
}

/** One operation of a consumable, applied in order. Adding a consumable never touches the reducer. */
export type ConsumableOp =
  | { readonly op: 'levelUpHand'; readonly hand: HandCategory }
  | { readonly op: 'enhanceCards'; readonly enhancement: string }
  | { readonly op: 'changeSuit'; readonly suit: Suit }
  | { readonly op: 'shiftRank'; readonly delta: number }
  | { readonly op: 'destroyCards' }
  | { readonly op: 'duplicateCard' };

/** A single-use card. Bought into the inventory, used later (in the shop or in a round). */
export interface ConsumableDefinition {
  readonly id: string;
  /** Shop price. */
  readonly cost: number;
  /**
   * Cards it asks for. `null` = asks for none, so it can be used in the shop; otherwise it can
   * only be used during a blind, on cards from the hand.
   */
  readonly targets: { readonly min: number; readonly max: number } | null;
  readonly ops: readonly ConsumableOp[];
}

/** A consumable held in the inventory. */
export interface ConsumableInstance {
  /** Unique within the run ("c1", "c2"…). */
  readonly instanceId: string;
  readonly consumableId: string;
}

/** Config numbers a voucher can change (the key is the `RunConfig` field it adds to). */
export type ModifiableConfigKey =
  'hands' | 'discards' | 'jokerSlots' | 'consumableSlots' | 'rerollBaseCost' | 'interestCap';

export interface ConfigModifier {
  readonly key: ModifiableConfigKey;
  readonly delta: number;
}

/** A permanent rule change bought in the shop: it only adds `delta`s to the run's config. */
export interface VoucherDefinition {
  readonly id: string;
  /** Shop price. */
  readonly cost: number;
  readonly modifiers: readonly ConfigModifier[];
}

export type PackKind = 'joker' | 'consumable' | 'card';

/** A pack bought in the shop: opens at once, `size` options are shown and `picks` can be taken. */
export interface PackDefinition {
  readonly id: string;
  /** Shop price. */
  readonly cost: number;
  readonly kind: PackKind;
  readonly size: number;
  readonly picks: number;
}

/** One option inside an open pack. A card gets its id only when it is picked. */
export type PackItem =
  | { readonly kind: 'joker'; readonly jokerId: string }
  | { readonly kind: 'consumable'; readonly consumableId: string }
  | {
      readonly kind: 'card';
      readonly suit: Suit;
      readonly rank: Rank;
      readonly enhancement: string;
    };

export type BlindKind = 'small' | 'big' | 'boss';

/** Boss rule as data. */
export interface BossDefinition {
  readonly id: string;
  /** Cards of this suit do not score and trigger nothing. */
  readonly debuffSuit?: Suit;
  /** Cards of these ranks do not score and trigger nothing. */
  readonly debuffRanks?: readonly Rank[];
  readonly handsDelta?: number;
  readonly discardsDelta?: number;
  /** Change to the number of cards in hand. */
  readonly handSizeDelta?: number;
}

export interface HandTypeStats {
  readonly chips: number;
  readonly mult: number;
  /** Added per level above 1. */
  readonly chipsPerLevel: number;
  readonly multPerLevel: number;
}

/** Everything that is content (and code: hooks), injected so tests and future content can extend it. */
export interface RunContent {
  readonly jokers: readonly JokerDefinition[];
  readonly enhancements: readonly EnhancementDefinition[];
  readonly bosses: readonly BossDefinition[];
  readonly consumables: readonly ConsumableDefinition[];
  readonly packs: readonly PackDefinition[];
  readonly vouchers: readonly VoucherDefinition[];
  readonly handTypes: Readonly<Record<HandCategory, HandTypeStats>>;
}
