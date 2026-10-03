import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_CONFIG,
  createRun,
  createSeededRng,
  hasUniqueIds,
  nextInt,
  replayRun,
  runReducer,
  shuffle,
  type Rng,
  type RunAction,
  type RunConfig,
  type RunState,
} from '../index';
import { deepFreeze } from '../testing/holdem-fixtures';

/** Low targets so random play gets past the first antes and visits shops and bosses. */
const GENTLE: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  anteTargets: [60, 120, 200, 300, 450, 650, 900, 1200],
  startingMoney: 10,
};

function randomAction(rng: Rng, state: RunState): RunAction {
  const roll = nextInt(rng, 100);
  if (state.phase === 'shop') {
    const affordable = state.shop.flatMap((o, i) => (!o.sold && o.price <= state.money ? [i] : []));
    if (roll < 40 && affordable.length > 0)
      return { type: 'buy', offerIndex: affordable[nextInt(rng, affordable.length)]! };
    if (roll < 50 && state.jokers.length >= 2)
      return { type: 'moveJoker', from: 0, to: state.jokers.length - 1 };
    if (roll < 55 && state.jokers.length > 0)
      return { type: 'sellJoker', instanceId: state.jokers[0]!.instanceId };
    return { type: 'leaveShop' };
  }
  const count = 1 + nextInt(rng, Math.min(5, state.hand.length));
  const cardIds = shuffle(rng, state.hand)
    .slice(0, count)
    .map((c) => c.id);
  if (roll < 25 && state.discardsLeft > 0) return { type: 'discard', cardIds };
  return { type: 'play', cardIds };
}

/** Plays a random run to the end; checks invariants on the way. Returns the final state and the log. */
function playRandomRun(seed: string, config: RunConfig, saveLoadAt: number) {
  const rng = createSeededRng(seed, 'player');
  let state = deepFreeze(createRun(seed, config).state);
  const actions: RunAction[] = [];
  for (let i = 0; i < 400 && state.status === 'in_progress'; i++) {
    if (i === saveLoadAt) state = deepFreeze(JSON.parse(JSON.stringify(state)) as RunState); // save + load
    const action = randomAction(rng, state);
    const result = runReducer(state, action);
    if (!result.ok)
      throw new Error(`Generated an illegal action ${action.type}: ${result.error.code}`);
    actions.push(action);
    state = deepFreeze(result.state);

    // Invariant 2 for the run: every card of the deck is in exactly one place (hand, draw pile, or played/discarded).
    const inPlay = [...state.hand, ...state.drawPile];
    expect(hasUniqueIds(inPlay)).toBe(true);
    expect(inPlay.every((c) => state.deck.some((d) => d.id === c.id))).toBe(true);
    expect(state.hand.length).toBeLessThanOrEqual(config.handSize);
    expect(state.money).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(state.roundScore)).toBe(true);
  }
  return { state, actions };
}

describe('run properties', () => {
  it('replaying the action log gives the same final state and score (also across a save/load)', () => {
    let deepest = 0;
    fc.assert(
      fc.property(fc.string(), fc.boolean(), fc.nat({ max: 60 }), (seed, gentle, saveLoadAt) => {
        const config = gentle ? GENTLE : DEFAULT_RUN_CONFIG;
        const { state, actions } = playRandomRun(seed, config, saveLoadAt);
        deepest = Math.max(deepest, state.ante);
        const replayed = replayRun({ seed, config, actions }).state;
        expect(replayed).toEqual(state);
        expect(replayed.bestHandScore).toBe(state.bestHandScore);
      }),
      { numRuns: 150 },
    );
    expect(deepest).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('the same seed and actions give the same events', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const { actions } = playRandomRun(seed, GENTLE, -1);
        expect(replayRun({ seed, config: GENTLE, actions }).events).toEqual(
          replayRun({ seed, config: GENTLE, actions }).events,
        );
      }),
      { numRuns: 30 },
    );
  });
});
