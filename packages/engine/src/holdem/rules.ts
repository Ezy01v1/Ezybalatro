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
  /** May be a seat with nobody dealt in (dead button). */
  readonly buttonSeat: number;
  /** Null when the small blind is dead this hand. */
  readonly smallBlindSeat: number | null;
  /** Small blind position, kept even when the blind is dead (the next button goes there). */
  readonly smallBlindPosition: number;
  readonly bigBlindSeat: number;
  /** Seats dealt in, in dealing order (starting left of the button). */
  readonly dealOrder: readonly number[];
  /** Players entering by posting owed blinds out of position. */
  readonly entryPosts: readonly {
    readonly seat: number;
    readonly bigBlind: boolean;
    readonly deadSmallBlind: boolean;
  }[];
  /** Sitting-out players the blinds passed this hand: they will owe them. */
  readonly missedBlinds: readonly { readonly seat: number; readonly blind: 'small' | 'big' }[];
  /** Players whose owed blinds are settled this hand (they are the big blind, post, or are waived). */
  readonly clearedSeats: readonly number[];
}

/** Is `seat` strictly inside the clockwise arc that goes from `from` to `to`? */
function isBetween(from: number, to: number, seat: number, maxSeats: number): boolean {
  const dist = (a: number, b: number) => (b - a + maxSeats) % maxSeats;
  return dist(from, seat) > 0 && dist(from, seat) < dist(from, to);
}

/**
 * Positions for the next hand under **dead-button** rules, or null if fewer than 2 players are
 * active (status `seated` with chips).
 *
 * - First hand: button on the lowest active seat, blinds to its left; everybody plays.
 * - The big blind moves to the next active player after the last big blind. Sitting-out players it
 *   skips owe the big blind.
 * - The small blind position is the last big blind's seat. If that player is no longer dealt in, the
 *   small blind is dead (and a sitting-out player there owes it).
 * - The button goes to the last small blind position, even if that seat is empty (dead button).
 *   When that would not leave the button behind the small blind (after heads-up), it goes to the seat
 *   right before the small blind.
 * - Players who owe blinds (new or returning) are dealt in when they are the big blind, or when they
 *   chose to post and are not in the dead zone (from the button to the small blind position).
 * - Heads-up: the button posts the small blind, the big blind keeps moving, owed blinds are waived.
 *   If fewer than 2 players could be dealt in, owed blinds are waived as well.
 */
export function nextHandPositions(state: TableState): HandPositions | null {
  const { maxSeats } = state.config;
  const seats = state.seats;
  const active = seats.flatMap((s, seat) =>
    s && s.status === 'seated' && s.stack > 0 ? [seat] : [],
  );
  if (active.length < 2) return null;
  const after = (seat: number) => findSeatFrom(seat + 1, maxSeats, (s) => active.includes(s))!;
  const owes = (seat: number) => !!(seats[seat]?.owesBigBlind || seats[seat]?.owesSmallBlind);
  const dealOrderFrom = (button: number, dealt: readonly number[]) => {
    const sorted = [...dealt].sort((a, b) => a - b);
    const first = sorted.indexOf(findSeatFrom(button + 1, maxSeats, (s) => dealt.includes(s))!);
    return sorted.map((_, i) => sorted[(first + i) % sorted.length]!);
  };
  const waiveAll = (
    button: number,
    sb: number | null,
    sbPosition: number,
    bb: number,
    missed: HandPositions['missedBlinds'] = [],
  ) => ({
    buttonSeat: button,
    smallBlindSeat: sb,
    smallBlindPosition: sbPosition,
    bigBlindSeat: bb,
    dealOrder: dealOrderFrom(button, active),
    entryPosts: [],
    missedBlinds: missed,
    clearedSeats: active.filter(owes),
  });

  const previousBigBlind = state.bigBlindSeat;
  if (previousBigBlind === null) {
    const button = active[0]!;
    const sb = active.length === 2 ? button : after(button);
    return waiveAll(button, sb, sb, after(sb));
  }

  const bb = after(previousBigBlind);
  const isSittingOut = (seat: number) => seats[seat]?.status === 'sitting_out';
  const missed: { seat: number; blind: 'small' | 'big' }[] = [];
  for (let seat = 0; seat < maxSeats; seat++) {
    if (isSittingOut(seat) && isBetween(previousBigBlind, bb, seat, maxSeats))
      missed.push({ seat, blind: 'big' });
  }

  if (active.length === 2) {
    const button = active.find((s) => s !== bb)!;
    return waiveAll(button, button, button, bb, missed);
  }

  const sbPosition = previousBigBlind;
  let button = state.smallBlindPosition ?? sbPosition;
  if (!isBetween(button, bb, sbPosition, maxSeats)) button = (sbPosition - 1 + maxSeats) % maxSeats;
  const inDeadZone = (seat: number) =>
    seat === button || seat === sbPosition || isBetween(button, sbPosition, seat, maxSeats);
  const dealt = active.filter(
    (seat) => !owes(seat) || seat === bb || (seats[seat]!.postBlindsToEnter && !inDeadZone(seat)),
  );
  if (isSittingOut(sbPosition)) missed.push({ seat: sbPosition, blind: 'small' });
  if (dealt.length < 2) {
    return waiveAll(
      button,
      active.includes(sbPosition) ? sbPosition : null,
      sbPosition,
      bb,
      missed,
    );
  }

  const posting = dealt.filter((seat) => owes(seat) && seat !== bb);
  return {
    buttonSeat: button,
    smallBlindSeat: dealt.includes(sbPosition) ? sbPosition : null,
    smallBlindPosition: sbPosition,
    bigBlindSeat: bb,
    dealOrder: dealOrderFrom(button, dealt),
    entryPosts: posting.map((seat) => ({
      seat,
      bigBlind: seats[seat]!.owesBigBlind,
      deadSmallBlind: seats[seat]!.owesSmallBlind,
    })),
    missedBlinds: missed,
    clearedSeats: dealt.filter(owes),
  };
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
