import { shuffle, type Rng } from './rng';

/** Spades, hearts, diamonds, clubs. */
export const SUITS = ['s', 'h', 'd', 'c'] as const;
export type Suit = (typeof SUITS)[number];

/** 2..10, J=11, Q=12, K=13, A=14. Aces also play low in the wheel (A-2-3-4-5). */
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  /** Unique within a deck. Standard cards use rank + suit, e.g. "As", "Td", "2c". */
  readonly id: string;
  readonly rank: Rank;
  readonly suit: Suit;
}

const RANK_CHARS: Record<Rank, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

const CHAR_TO_RANK = new Map<string, Rank>(RANKS.map((rank) => [RANK_CHARS[rank], rank]));

export function cardId(rank: Rank, suit: Suit): string {
  return `${RANK_CHARS[rank]}${suit}`;
}

export function makeCard(rank: Rank, suit: Suit): Card {
  return { id: cardId(rank, suit), rank, suit };
}

/** The 52 cards in a fixed order (by suit, then rank). */
export function createStandardDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => makeCard(rank, suit)));
}

export function shuffleDeck<T extends Card>(rng: Rng, deck: readonly T[]): T[] {
  return shuffle(rng, deck);
}

/** Parses "As", "td", "10h" (rank case-insensitive, suit lower or upper case). */
export function parseCard(text: string): Card {
  const trimmed = text.trim();
  const rankPart = trimmed.slice(0, -1).toUpperCase();
  const suitPart = trimmed.slice(-1).toLowerCase();
  const rank = CHAR_TO_RANK.get(rankPart === '10' ? 'T' : rankPart);
  if (rank === undefined || !(SUITS as readonly string[]).includes(suitPart)) {
    throw new RangeError(`Invalid card: "${text}"`);
  }
  return makeCard(rank, suitPart as Suit);
}

/** Parses a space-separated list: "As Kd 7c". */
export function parseCards(text: string): Card[] {
  return text.split(/\s+/).filter(Boolean).map(parseCard);
}

/** True if every card id appears at most once. */
export function hasUniqueIds(cards: readonly Card[]): boolean {
  return new Set(cards.map((c) => c.id)).size === cards.length;
}

/** True if `cards` is exactly the standard 52-card deck, in any order. */
export function isCompleteStandardDeck(cards: readonly Card[]): boolean {
  if (cards.length !== 52 || !hasUniqueIds(cards)) return false;
  return cards.every(
    (c) =>
      (RANKS as readonly number[]).includes(c.rank) &&
      (SUITS as readonly string[]).includes(c.suit) &&
      c.id === cardId(c.rank, c.suit),
  );
}
