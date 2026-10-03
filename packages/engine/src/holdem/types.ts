import type { Card } from '../cards';
import type { HandCategory } from '../hands/hand-category';

/**
 * Texas Hold'em No-Limit table state. Plain serializable data (ADR 0003): the reducer never mutates
 * it and never reads the clock or randomness. Chips are integers.
 *
 * Secrets live here (the undealt deck and every hole card): never send this object to a client,
 * only `viewFor(state, playerId)`.
 */
export interface TableConfig {
  /** 2 to 6. */
  readonly maxSeats: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly minBuyIn: number;
  readonly maxBuyIn: number;
}

/**
 * - `seated`: dealt in from the next hand.
 * - `sitting_out`: keeps the seat but is not dealt in.
 * - `leaving`: asked to leave during a hand they are part of; the seat is freed when the hand settles.
 */
export type SeatStatus = 'seated' | 'sitting_out' | 'leaving';

export interface SeatState {
  readonly playerId: string;
  /** Chips in front of the player. During a hand, chips already bet are not here but in `HandPlayer.totalBet`. */
  readonly stack: number;
  readonly status: SeatStatus;
}

/** `settled` covers both a showdown and a hand won because everyone else folded. */
export type HandStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'settled' | 'voided';

export interface HandPlayer {
  readonly seat: number;
  readonly playerId: string;
  readonly holeCards: readonly [Card, Card];
  /** Chips committed in the current betting round. */
  readonly streetBet: number;
  /** Chips committed in the whole hand (blinds included). */
  readonly totalBet: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  /** Took a voluntary action in the current betting round (posting a blind does not count). */
  readonly hasActed: boolean;
  /** `currentBet` right after this player's last voluntary action in this round. Decides if a raise reopens the action for them. */
  readonly actedAtBet: number;
}

export interface Pot {
  readonly amount: number;
  /** Seats that can win it (not folded and contributed up to this level). */
  readonly eligibleSeats: readonly number[];
}

export interface PotAward extends Pot {
  readonly winners: readonly { readonly seat: number; readonly amount: number }[];
}

export interface ShowdownHand {
  readonly seat: number;
  readonly holeCards: readonly [Card, Card];
  readonly category: HandCategory;
  readonly bestCards: readonly Card[];
  readonly value: number;
}

export interface HandState {
  readonly handNumber: number;
  readonly street: HandStreet;
  readonly buttonSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  /** Undealt cards, top first. Secret. */
  readonly deck: readonly Card[];
  readonly board: readonly Card[];
  /** Players dealt in, ordered by seat index. */
  readonly players: readonly HandPlayer[];
  /** Highest `streetBet` the others must match. Preflop it is the full big blind even if the big blind is all-in for less. */
  readonly currentBet: number;
  /** Size of the last full bet or raise in this round: the minimum raise increment. Starts at the big blind. */
  readonly minRaise: number;
  /** Seat whose turn it is, or null when no one can act (between hands or after settling). */
  readonly toAct: number | null;
  /** Stacks before the blinds, to void the hand (ADR 0004). */
  readonly startingStacks: readonly { readonly seat: number; readonly stack: number }[];
  /** Filled when the hand settles. */
  readonly awards: readonly PotAward[];
  /** Hands shown at showdown. Empty if the hand ended by folds. */
  readonly showdown: readonly ShowdownHand[];
}

export interface TableState {
  readonly config: TableConfig;
  /** Index = seat number. */
  readonly seats: readonly (SeatState | null)[];
  /** Button of the last hand dealt, null before the first hand. */
  readonly buttonSeat: number | null;
  /** Number of hands dealt so far. */
  readonly handNumber: number;
  /** Current or last hand. A new hand can start when it is null, `settled` or `voided`. */
  readonly hand: HandState | null;
}

export type HoldemAction =
  | {
      readonly type: 'sit';
      readonly playerId: string;
      readonly seat: number;
      readonly buyIn: number;
    }
  | { readonly type: 'leave'; readonly playerId: string }
  | { readonly type: 'sitOut'; readonly playerId: string }
  | { readonly type: 'sitIn'; readonly playerId: string }
  /**
   * Starts a hand: moves the button, posts blinds and deals. `deck` is the full 52-card deck already
   * shuffled by the caller (the server, with a CSPRNG), so the reducer stays pure and replayable.
   */
  | { readonly type: 'postBlinds'; readonly deck: readonly Card[] }
  | { readonly type: 'fold'; readonly playerId: string }
  | { readonly type: 'check'; readonly playerId: string }
  | { readonly type: 'call'; readonly playerId: string }
  /** `amount`: total committed this round after betting ("bet to"). Only when nobody has bet. */
  | { readonly type: 'bet'; readonly playerId: string; readonly amount: number }
  /** `to`: total committed this round after raising ("raise to"). */
  | { readonly type: 'raise'; readonly playerId: string; readonly to: number }
  | { readonly type: 'allIn'; readonly playerId: string }
  /** Sent by the server when the turn clock expires: check if free, otherwise fold; the seat sits out from the next hand. */
  | { readonly type: 'timeout'; readonly playerId: string }
  /** Server restart mid-hand (ADR 0004): stacks go back to `startingStacks`. */
  | { readonly type: 'voidHand' };

export type HoldemErrorCode =
  | 'NOT_YOUR_TURN'
  | 'INVALID_AMOUNT'
  | 'INVALID_ACTION'
  | 'SEAT_TAKEN'
  | 'INVALID_SEAT'
  | 'ALREADY_SEATED'
  | 'NOT_SEATED'
  | 'INVALID_BUY_IN'
  | 'HAND_IN_PROGRESS'
  | 'NO_HAND_IN_PROGRESS'
  | 'NOT_ENOUGH_PLAYERS'
  | 'INVALID_DECK';

export interface HoldemError {
  readonly code: HoldemErrorCode;
  /** Developer-facing. Never contains cards. */
  readonly message: string;
}

export type BettingAction = 'fold' | 'check' | 'call' | 'bet' | 'raise';

/** Events are safe to broadcast to the whole table: none of them carries hole cards before the showdown. */
export type HoldemEvent =
  | {
      readonly type: 'playerSat';
      readonly seat: number;
      readonly playerId: string;
      readonly stack: number;
    }
  /** `cashOut`: chips that go back to the wallet. */
  | {
      readonly type: 'playerLeft';
      readonly seat: number;
      readonly playerId: string;
      readonly cashOut: number;
    }
  | { readonly type: 'playerSatOut'; readonly seat: number; readonly playerId: string }
  | { readonly type: 'playerSatIn'; readonly seat: number; readonly playerId: string }
  | {
      readonly type: 'handStarted';
      readonly handNumber: number;
      readonly buttonSeat: number;
      readonly smallBlindSeat: number;
      readonly bigBlindSeat: number;
      readonly seats: readonly number[];
    }
  | {
      readonly type: 'blindPosted';
      readonly seat: number;
      readonly blind: 'small' | 'big';
      readonly amount: number;
      readonly allIn: boolean;
    }
  | {
      readonly type: 'playerActed';
      readonly seat: number;
      readonly action: BettingAction;
      /** Chips added to the pot by this action. */
      readonly amount: number;
      /** `streetBet` after the action. */
      readonly to: number;
      readonly allIn: boolean;
      /** Set when the server acted for the player. */
      readonly auto?: 'timeout' | 'leave';
    }
  | {
      readonly type: 'streetDealt';
      readonly street: 'flop' | 'turn' | 'river';
      readonly cards: readonly Card[];
    }
  | { readonly type: 'showdown'; readonly hands: readonly ShowdownHand[] }
  | ({ readonly type: 'potAwarded'; readonly potIndex: number } & PotAward)
  | {
      readonly type: 'handSettled';
      readonly handNumber: number;
      readonly stacks: readonly { readonly seat: number; readonly stack: number }[];
    }
  | { readonly type: 'handVoided'; readonly handNumber: number };

export type HoldemResult =
  | { readonly ok: true; readonly state: TableState; readonly events: readonly HoldemEvent[] }
  | { readonly ok: false; readonly error: HoldemError };
