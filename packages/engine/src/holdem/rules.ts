import type { HandPlayer, HandState, TableState } from './types';

/** Betting rounds in which players can still act. */
export function isHandInProgress(hand: HandState | null): hand is HandState {
  return hand !== null && hand.street !== 'settled' && hand.street !== 'voided';
}

/** First seat at or after `start` (clockwise, wrapping) that matches. */
export function findSeatFrom(
  start: number,
  maxSeats: number,
  matches: (seat: number) => boolean,
): number | null {
  for (let i = 0; i < maxSeats; i++) {
    const seat = (start + i) % maxSeats;
    if (matches(seat)) return seat;
  }
  return null;
}

export interface HandPositions {
  readonly buttonSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  /** Seats dealt in, in dealing order (starting left of the button). */
  readonly dealOrder: readonly number[];
}

/**
 * Seats for the next hand, or null if fewer than 2 players can be dealt in. Players with status
 * `seated` and chips are dealt in. The button moves to the next dealt-in seat clockwise (first hand:
 * lowest seat). Heads-up the button posts the small blind. Simplified "moving button": no dead button
 * and no missed-blind tracking.
 */
export function nextHandPositions(state: TableState): HandPositions | null {
  const { maxSeats } = state.config;
  const dealtIn = state.seats.flatMap((s, seat) =>
    s && s.status === 'seated' && s.stack > 0 ? [seat] : [],
  );
  if (dealtIn.length < 2) return null;
  const after = (seat: number) => findSeatFrom(seat + 1, maxSeats, (s) => dealtIn.includes(s))!;
  const buttonSeat = state.buttonSeat === null ? dealtIn[0]! : after(state.buttonSeat);
  const smallBlindSeat = dealtIn.length === 2 ? buttonSeat : after(buttonSeat);
  const bigBlindSeat = after(smallBlindSeat);
  const first = dealtIn.indexOf(after(buttonSeat));
  const dealOrder = dealtIn.map((_, i) => dealtIn[(first + i) % dealtIn.length]!);
  return { buttonSeat, smallBlindSeat, bigBlindSeat, dealOrder };
}

export function othersCanAct(hand: HandState, player: HandPlayer): boolean {
  return hand.players.some((p) => p !== player && !p.folded && !p.allIn);
}

/**
 * Can this player bet or raise if the chips allow it? Before acting in a round, always. After acting,
 * only when facing at least a full raise since their last action: an all-in for less than a full raise
 * does not reopen the action, but several short all-ins that add up to a full raise do (TDA rule).
 */
export function hasRaiseRight(hand: HandState, player: HandPlayer): boolean {
  return !player.hasActed || hand.currentBet - player.actedAtBet >= hand.minRaise;
}

/** Does this player still owe a decision in the current round? */
export function needsToAct(hand: HandState, player: HandPlayer): boolean {
  if (player.folded || player.allIn) return false;
  const facingBet = player.streetBet < hand.currentBet;
  // With nobody else able to respond, a player who is not facing a bet has nothing to decide.
  if (!facingBet && !othersCanAct(hand, player)) return false;
  return facingBet || !player.hasActed;
}

export interface LegalActions {
  readonly seat: number;
  readonly canCheck: boolean;
  /** Chips the player adds by calling; 0 if there is nothing to call. Capped at the stack (all-in call). */
  readonly callAmount: number;
  /** Allowed `amount` for `bet` ("bet to"), or null. */
  readonly bet: { readonly min: number; readonly max: number } | null;
  /** Allowed `to` for `raise` ("raise to"), or null. */
  readonly raise: { readonly min: number; readonly max: number } | null;
  /** Chips the player adds by going all-in, or null if all-in is not allowed now. */
  readonly allIn: number | null;
}

/** What `playerId` may do right now, or null if it is not their turn. Folding is always allowed on your turn. */
export function legalActions(state: TableState, playerId: string): LegalActions | null {
  const hand = state.hand;
  if (!isHandInProgress(hand) || hand.toAct === null) return null;
  const player = hand.players.find((p) => p.seat === hand.toAct);
  if (!player || player.playerId !== playerId) return null;
  const stack = state.seats[player.seat]?.stack ?? 0;
  const toCall = Math.max(0, hand.currentBet - player.streetBet);
  const canRespond = othersCanAct(hand, player);
  const allInTo = player.streetBet + stack;

  const bet =
    hand.currentBet === 0 && canRespond && stack > 0
      ? { min: Math.min(state.config.bigBlind, stack), max: stack }
      : null;
  const raise =
    hand.currentBet > 0 && canRespond && hasRaiseRight(hand, player) && stack > toCall
      ? { min: Math.min(hand.currentBet + hand.minRaise, allInTo), max: allInTo }
      : null;
  const allInAllowed = stack > 0 && (stack <= toCall || bet !== null || raise !== null);

  return {
    seat: player.seat,
    canCheck: toCall === 0,
    callAmount: Math.min(toCall, stack),
    bet,
    raise,
    allIn: allInAllowed ? stack : null,
  };
}
