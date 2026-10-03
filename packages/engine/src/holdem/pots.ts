import type { Pot } from './types';

export interface Contribution {
  readonly seat: number;
  readonly totalBet: number;
  readonly folded: boolean;
}

/**
 * Splits the chips committed in a hand into the main pot and side pots.
 *
 * Each pot is a layer up to the smallest remaining contribution among players still in the hand;
 * folded players' chips fill the layers but they are never eligible. A top layer with a single
 * eligible seat is an uncalled bet: it is returned to that player when awarded. `deadMoney` (dead
 * blinds, owned by nobody) goes to the main pot.
 */
export function buildPots(contributions: readonly Contribution[], deadMoney = 0): Pot[] {
  const remaining = new Map(contributions.map((c) => [c.seat, c.totalBet]));
  const folded = new Set(contributions.filter((c) => c.folded).map((c) => c.seat));
  const pots: Pot[] = [];

  for (;;) {
    const live = [...remaining].filter(([seat, chips]) => chips > 0 && !folded.has(seat));
    if (live.length === 0) break;
    const level = Math.min(...live.map(([, chips]) => chips));
    let amount = 0;
    for (const [seat, chips] of remaining) {
      const taken = Math.min(chips, level);
      amount += taken;
      remaining.set(seat, chips - taken);
    }
    pots.push({ amount, eligibleSeats: live.map(([seat]) => seat).sort((a, b) => a - b) });
  }

  // Folded chips above every live contribution (e.g. the blinds fold to a player who has not put
  // anything in yet) go to the top pot, or form one for the players still in the hand.
  const stillIn = contributions
    .filter((c) => !c.folded)
    .map((c) => c.seat)
    .sort((a, b) => a - b);
  const leftover = [...remaining.values()].reduce((sum, chips) => sum + chips, 0);
  if (leftover > 0) {
    const last = pots.pop();
    pots.push(
      last
        ? { ...last, amount: last.amount + leftover }
        : { amount: leftover, eligibleSeats: stillIn },
    );
  }
  if (deadMoney > 0) {
    const main = pots[0];
    if (main) pots[0] = { ...main, amount: main.amount + deadMoney };
    else pots.push({ amount: deadMoney, eligibleSeats: stillIn });
  }
  return pots;
}

/**
 * Splits `amount` among `winnerSeats` in equal integer shares. Leftover chips (the odd chip) go one
 * by one to the winners in seat order starting from the first seat to the left of the button.
 */
export function splitPot(
  amount: number,
  winnerSeats: readonly number[],
  buttonSeat: number,
  maxSeats: number,
): { seat: number; amount: number }[] {
  const distanceFromButton = (seat: number) => (seat - buttonSeat - 1 + maxSeats) % maxSeats;
  const ordered = [...winnerSeats].sort((a, b) => distanceFromButton(a) - distanceFromButton(b));
  const share = Math.floor(amount / ordered.length);
  const oddChips = amount - share * ordered.length;
  return ordered.map((seat, i) => ({ seat, amount: share + (i < oddChips ? 1 : 0) }));
}
