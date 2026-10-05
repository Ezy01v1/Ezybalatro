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
  readonly handTypes: Readonly<Record<HandCategory, HandTypeStats>>;
}
