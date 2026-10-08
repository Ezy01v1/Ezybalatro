import { nextInt, type Rng } from '../rng';
import type { HoldemAction } from '../holdem/types';
import type { TableView } from '../holdem/view';
import { BOT_PERSONALITIES, type BotPersonality } from './personalities';
import { postflopStrength, preflopStrength } from './strength';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Decides what a bot does from its own redacted view, or null if it is not its turn.
 * Consumes exactly one bluff roll (plus one sizing roll when it bets or raises) per decision.
 */
export function decideBotAction(
  view: TableView,
  rng: Rng,
  personality: BotPersonality,
): HoldemAction | null {
  const legal = view.legal;
  const hand = view.hand;
  if (!legal || !hand || view.mySeat === null) return null;
  const me = hand.players.find((p) => p.seat === view.mySeat);
  const seat = view.seats[view.mySeat];
  if (!me || !seat || !me.holeCards) return null;
  const playerId = me.playerId;

  const strength =
    hand.board.length === 0
      ? preflopStrength(me.holeCards)
      : postflopStrength(me.holeCards, hand.board);
  const pot = hand.pot;
  const call = legal.callAmount;
  const potOdds = call > 0 ? call / (pot + call) : 0;
  const profile = BOT_PERSONALITIES[personality];
  const stackBB = seat.stack / view.config.bigBlind;

  const bluffs = nextInt(rng, 100) < profile.bluffPercent;
  const strong = strength >= profile.raiseAbove;

  if ((strong || bluffs) && (legal.bet || legal.raise)) {
    if (legal.allIn !== null && stackBB <= 10 && strength >= 0.85) {
      return { type: 'allIn', playerId };
    }
    const fraction = 0.5 + nextInt(rng, 51) / 100;
    if (legal.bet) {
      const amount = clamp(Math.round(pot * fraction), legal.bet.min, legal.bet.max);
      return { type: 'bet', playerId, amount };
    }
    if (legal.raise) {
      const to = clamp(
        hand.currentBet + Math.round((pot + call) * fraction),
        legal.raise.min,
        legal.raise.max,
      );
      return { type: 'raise', playerId, to };
    }
  }

  if (legal.canCheck) return { type: 'check', playerId };
  if (strong || strength >= potOdds + 0.15 + profile.callMargin) return { type: 'call', playerId };
  return { type: 'fold', playerId };
}
