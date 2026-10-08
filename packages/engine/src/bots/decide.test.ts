import fc from 'fast-check';
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
  type BotPersonality,
  type HoldemAction,
  type Rng,
  type TableState,
} from '../index';
import { deepFreeze, run, stackedDeck, tableWith } from '../testing/holdem-fixtures';

const constRng = (value: number): Rng => ({ nextUint32: () => value });

function playerToAct(state: TableState): string {
  const hand = state.hand!;
  return hand.players.find((p) => p.seat === hand.toAct)!.playerId;
}

/** Plays a whole seeded session with bots and calls `visit` before every decision. */
function playBots(
  seed: string,
  hands: number,
  personalityOf: (index: number) => BotPersonality,
  visit: (state: TableState, playerId: string, personality: BotPersonality) => void,
): void {
  const rng = createSeededRng(seed, 'bots');
  let state = deepFreeze(tableWith([2000, 2000, 2000, 2000, 2000, 2000]));
  for (let h = 0; h < hands; h++) {
    const started = holdemReducer(state, {
      type: 'postBlinds',
      deck: shuffleDeck(rng, createStandardDeck()),
    });
    if (!started.ok) {
      for (const [seatIndex, s] of state.seats.entries())
        if (s && s.stack === 0) {
          state = run(state, { type: 'leave', playerId: s.playerId }).state;
          state = run(state, {
            type: 'sit',
            playerId: s.playerId,
            seat: seatIndex,
            buyIn: 2000,
          }).state;
        }
      continue;
    }
    state = deepFreeze(started.state);
    let guard = 0;
    while (isHandInProgress(state.hand)) {
      if (++guard > 500) throw new Error('Hand did not finish');
      const playerId = playerToAct(state);
      const index = Number(playerId.slice(1));
      const personality = personalityOf(index);
      visit(state, playerId, personality);
      const action = decideBotAction(viewFor(state, playerId), rng, personality)!;
      const result = holdemReducer(state, action);
      if (!result.ok) throw new Error(`rejected ${JSON.stringify(action)}: ${result.error.code}`);
      state = deepFreeze(result.state);
    }
    for (const [seatIndex, s] of state.seats.entries())
      if (s && s.stack === 0) {
        state = run(state, { type: 'leave', playerId: s.playerId }).state;
        state = run(state, {
          type: 'sit',
          playerId: s.playerId,
          seat: seatIndex,
          buyIn: 2000,
        }).state;
      }
  }
}

describe('decideBotAction', () => {
  it('returns null when it is not the bot turn', () => {
    let state = tableWith([100, 100, 100]);
    state = run(state, { type: 'postBlinds', deck: stackedDeck(state, {}) }).state;
    const hand = state.hand!;
    const other = hand.players.find((p) => p.seat !== hand.toAct)!.playerId;
    expect(decideBotAction(viewFor(state, other), constRng(99), 'normal')).toBeNull();
    expect(decideBotAction(viewFor(state, 'spectator'), constRng(99), 'normal')).toBeNull();
  });

  it('AA preflop never folds, for every personality and seed', () => {
    let base = tableWith([200, 200, 200]);
    base = run(base, {
      type: 'postBlinds',
      deck: stackedDeck(base, { 0: 'Ah Ad', 1: '7c 2d', 2: '9s 3h' }),
    }).state;
    const playerId = playerToAct(base);
    // Seat 0 is the button and first to act in a 3-handed game, holding aces.
    expect(base.hand!.players.find((p) => p.playerId === playerId)!.holeCards[0].rank).toBe(14);
    for (let i = 0; i < 200; i++) {
      for (const personality of BOT_PERSONALITY_IDS) {
        const action = decideBotAction(
          viewFor(base, playerId),
          createSeededRng(`aa-${i}`),
          personality,
        );
        expect(action).not.toBeNull();
        expect(action!.type).not.toBe('fold');
        expect(action).toMatchObject({ playerId });
      }
    }
  });

  it('72o with nothing to call checks when the bluff roll fails', () => {
    let state = tableWith([200, 200, 200]);
    state = run(state, {
      type: 'postBlinds',
      deck: stackedDeck(state, { 0: 'Ah Kd', 1: 'Qs Qd', 2: '7s 2d' }),
    }).state;
    state = run(state, { type: 'call', playerId: 'p0' }, { type: 'call', playerId: 'p1' }).state;
    expect(playerToAct(state)).toBe('p2');
    for (const personality of BOT_PERSONALITY_IDS) {
      expect(decideBotAction(viewFor(state, 'p2'), constRng(99), personality)).toEqual({
        type: 'check',
        playerId: 'p2',
      });
    }
  });

  it('is deterministic for the same rng state', () => {
    playBots(
      'det',
      5,
      () => 'normal',
      (state, playerId, personality) => {
        const view = viewFor(state, playerId);
        const a = decideBotAction(view, createSeededRng('x'), personality);
        const b = decideBotAction(view, createSeededRng('x'), personality);
        expect(a).toEqual(b);
      },
    );
  });

  it('aggressive bets or raises more often than cautious', () => {
    let aggressive = 0;
    let cautious = 0;
    let views = 0;
    const isAggro = (a: HoldemAction | null) =>
      a !== null && (a.type === 'bet' || a.type === 'raise' || a.type === 'allIn');
    playBots(
      'mix',
      400,
      (i) => (i % 2 === 0 ? 'aggressive' : 'cautious'),
      (state, playerId) => {
        if (views >= 2000) return;
        views++;
        const view = viewFor(state, playerId);
        const seed = `cmp-${views}`;
        if (isAggro(decideBotAction(view, createSeededRng(seed), 'aggressive'))) aggressive++;
        if (isAggro(decideBotAction(view, createSeededRng(seed), 'cautious'))) cautious++;
      },
    );
    expect(views).toBeGreaterThan(1000);
    expect(aggressive).toBeGreaterThan(cautious);
  });

  it('every decision is accepted by the reducer (property)', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        // playBots throws if the reducer rejects any decision.
        playBots(
          seed,
          100,
          (i) => BOT_PERSONALITY_IDS[i % BOT_PERSONALITY_IDS.length]!,
          () => {},
        );
      }),
      { numRuns: 20 },
    );
  }, 120_000);
});
