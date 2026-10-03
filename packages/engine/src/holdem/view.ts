import type { Card } from '../cards';
import { legalActions, type LegalActions } from './rules';
import type {
  HandStreet,
  PotAward,
  SeatStatus,
  ShowdownHand,
  TableConfig,
  TableState,
} from './types';

export interface SeatView {
  readonly seat: number;
  readonly playerId: string;
  readonly stack: number;
  readonly status: SeatStatus;
}

export interface HandPlayerView {
  readonly seat: number;
  readonly playerId: string;
  readonly streetBet: number;
  readonly totalBet: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  /** Own cards always; someone else's only after they are shown at showdown. */
  readonly holeCards: readonly [Card, Card] | null;
}

export interface HandView {
  readonly handNumber: number;
  readonly street: HandStreet;
  readonly buttonSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  readonly board: readonly Card[];
  readonly players: readonly HandPlayerView[];
  readonly currentBet: number;
  readonly minRaise: number;
  readonly toAct: number | null;
  /** All chips committed in the hand. */
  readonly pot: number;
  readonly awards: readonly PotAward[];
  readonly showdown: readonly ShowdownHand[];
}

export interface TableView {
  readonly config: TableConfig;
  readonly seats: readonly (SeatView | null)[];
  readonly handNumber: number;
  readonly hand: HandView | null;
  /** The viewer's seat, or null for a spectator. */
  readonly mySeat: number | null;
  /** What the viewer may do now, or null if it is not their turn. */
  readonly legal: LegalActions | null;
}

/**
 * What `playerId` is allowed to see (invariant 4). Never includes the undealt deck, burn cards or
 * other players' hole cards unless they were shown at showdown. Built field by field (no spreads of
 * internal objects) so a new secret field in the state cannot leak by accident.
 */
export function viewFor(state: TableState, playerId: string): TableView {
  const mySeatIndex = state.seats.findIndex((s) => s?.playerId === playerId);
  const mySeat = mySeatIndex === -1 ? null : mySeatIndex;
  const hand = state.hand;
  const shown = new Set(hand?.showdown.map((h) => h.seat) ?? []);

  return {
    config: state.config,
    seats: state.seats.map((s, seat) =>
      s ? { seat, playerId: s.playerId, stack: s.stack, status: s.status } : null,
    ),
    handNumber: state.handNumber,
    mySeat,
    legal: legalActions(state, playerId),
    hand: hand
      ? {
          handNumber: hand.handNumber,
          street: hand.street,
          buttonSeat: hand.buttonSeat,
          smallBlindSeat: hand.smallBlindSeat,
          bigBlindSeat: hand.bigBlindSeat,
          board: [...hand.board],
          currentBet: hand.currentBet,
          minRaise: hand.minRaise,
          toAct: hand.toAct,
          pot: hand.players.reduce((sum, p) => sum + p.totalBet, 0),
          awards: hand.awards,
          showdown: hand.showdown,
          players: hand.players.map((p) => ({
            seat: p.seat,
            playerId: p.playerId,
            streetBet: p.streetBet,
            totalBet: p.totalBet,
            folded: p.folded,
            allIn: p.allIn,
            holeCards: p.playerId === playerId || shown.has(p.seat) ? p.holeCards : null,
          })),
        }
      : null,
  };
}
