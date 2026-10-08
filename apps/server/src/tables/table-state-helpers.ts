import {
  isHandInProgress,
  type HoldemAction,
  type HoldemEvent,
  type TableState,
} from '@naipes/engine';
import type { PlayerAction } from '@naipes/shared';

/** Bots buy in from (and cash out to) the house bankroll; everybody else uses the wallet. */
export const isBotId = (id: string): boolean => id.startsWith('bot:');

/** Builds the reducer action field by field, so nothing but the known fields reaches the engine. */
export function toHoldemAction(playerId: string, action: PlayerAction): HoldemAction {
  switch (action.type) {
    case 'bet':
      return { type: 'bet', playerId, amount: action.amount };
    case 'raise':
      return { type: 'raise', playerId, to: action.to };
    case 'fold':
    case 'check':
    case 'call':
    case 'allIn':
      return { type: action.type, playerId };
  }
}

/** Stacks plus the chips of the hand in progress (bets and dead blinds). */
export function chipsOnTable(state: TableState): number {
  let sum = 0;
  for (const seat of state.seats) sum += seat?.stack ?? 0;
  const hand = state.hand;
  if (isHandInProgress(hand)) {
    sum += hand.deadMoney;
    for (const p of hand.players) sum += p.totalBet;
  }
  return sum;
}

/**
 * What each seated player gets back if the table is torn down without the reducer: the stack at the
 * start of the hand in progress for players dealt in, the current stack for everybody else.
 */
export function refundsFromState(state: TableState): { playerId: string; amount: number }[] {
  const hand = isHandInProgress(state.hand) ? state.hand : null;
  return state.seats.flatMap((seat, index) => {
    if (!seat) return [];
    const starting = hand?.startingStacks.find((s) => s.seat === index);
    return [{ playerId: seat.playerId, amount: starting ? starting.stack : seat.stack }];
  });
}

export function playerLeftEvents(events: readonly HoldemEvent[]) {
  return events.filter(
    (e): e is Extract<HoldemEvent, { type: 'playerLeft' }> => e.type === 'playerLeft',
  );
}
