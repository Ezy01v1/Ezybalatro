import { describe, expect, it } from 'vitest';
import {
  BOT_PERSONALITY_IDS,
  createSeededRng,
  createStandardDeck,
  decideBotAction,
  holdemReducer,
  isHandInProgress,
  shuffleDeck,
  viewFor,
  type TableState,
} from '../index';
import { run, tableWith, totalChips } from '../testing/holdem-fixtures';

const CONFIG = { maxSeats: 6, smallBlind: 10, bigBlind: 20, minBuyIn: 1, maxBuyIn: 1_000_000 };
const BUY_IN = 2000;

describe('bot simulation', () => {
  it('plays 5,000 hands without a rejected action or a chip leak', () => {
    const rng = createSeededRng('sim');
    let state: TableState = tableWith(Array(6).fill(BUY_IN), CONFIG);
    let expected = 6 * BUY_IN;
    let hands = 0;

    const rebuy = () => {
      for (const [seatIndex, s] of state.seats.entries()) {
        if (s && s.stack === 0) {
          state = run(state, { type: 'leave', playerId: s.playerId }).state;
          state = run(state, {
            type: 'sit',
            playerId: s.playerId,
            seat: seatIndex,
            buyIn: BUY_IN,
          }).state;
          expected += BUY_IN;
        }
      }
    };

    while (hands < 5000) {
      rebuy();
      const started = holdemReducer(state, {
        type: 'postBlinds',
        deck: shuffleDeck(rng, createStandardDeck()),
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      state = started.state;
      let guard = 0;
      while (isHandInProgress(state.hand)) {
        if (++guard > 500) throw new Error('Hand did not finish');
        const hand = state.hand;
        const playerId = hand.players.find((p) => p.seat === hand.toAct)!.playerId;
        const personality = BOT_PERSONALITY_IDS[Number(playerId.slice(1)) % 3]!;
        const action = decideBotAction(viewFor(state, playerId), rng, personality);
        expect(action).not.toBeNull();
        const result = holdemReducer(state, action!);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        state = result.state;
        expect(totalChips(state)).toBe(expected);
      }
      hands++;
    }
    expect(hands).toBe(5000);
  }, 120_000);
});
