import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTENT,
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

/**
 * Sells or applies a random consumable of the inventory (targets chosen at random from the hand,
 * as many as the consumable asks for). Null when the random pick would be illegal (an Ace that
 * cannot go up, a deck too small to scrap): the caller then does something else.
 */
function consumableAction(rng: Rng, state: RunState): RunAction | null {
  const instance = state.consumables[nextInt(rng, state.consumables.length)]!;
  if (nextInt(rng, 8) === 0) return { type: 'sellConsumable', instanceId: instance.instanceId };
  const def = DEFAULT_CONTENT.consumables.find((c) => c.id === instance.consumableId)!;
  const cardIds = def.targets
    ? shuffle(rng, state.hand)
        .slice(0, def.targets.min + nextInt(rng, def.targets.max - def.targets.min + 1))
        .map((c) => c.id)
    : undefined;
  const action: RunAction = {
    type: 'applyConsumable',
    instanceId: instance.instanceId,
    ...(cardIds ? { cardIds } : {}),
  };
  return runReducer(state, action).ok ? action : null;
}

function randomAction(rng: Rng, state: RunState): RunAction {
  const roll = nextInt(rng, 100);
  if (state.phase === 'shop') {
    const jokersFull = state.jokers.length >= state.config.jokerSlots;
    const consumablesFull = state.consumables.length >= state.config.consumableSlots;
    const affordable = state.shop.flatMap((o, i) =>
      !o.sold &&
      // Packs and vouchers join the generator when they can be bought.
      (o.kind === 'joker' || o.kind === 'consumable') &&
      o.price <= state.money &&
      !(o.kind === 'joker' && jokersFull) &&
      !(o.kind === 'consumable' && consumablesFull)
        ? [i]
        : [],
    );
    // Card-changing consumables are bought first: their operations need plenty of coverage.
    const cardChangers = affordable.filter((i) => {
      const offer = state.shop[i]!;
      return offer.kind === 'consumable' && ['twin', 'scrap'].includes(offer.consumableId);
    });
    const pool = cardChangers.length > 0 && roll < 60 ? cardChangers : affordable;
    if (roll < 60 && pool.length > 0)
      return { type: 'buy', offerIndex: pool[nextInt(rng, pool.length)]! };
    if (roll < 50 && state.jokers.length >= 2)
      return { type: 'moveJoker', from: 0, to: state.jokers.length - 1 };
    if (roll < 55 && state.jokers.length > 0)
      return { type: 'sellJoker', instanceId: state.jokers[0]!.instanceId };
    if (roll < 62 && state.money >= state.rerollCost) return { type: 'reroll' };
    if (roll < 80 && state.consumables.length > 0)
      return consumableAction(rng, state) ?? { type: 'leaveShop' };
    return { type: 'leaveShop' };
  }
  if (roll > 95) return { type: 'sortHand', by: roll % 2 === 0 ? 'rank' : 'suit' };
  if (roll > 65 && state.consumables.length > 0) {
    const action = consumableAction(rng, state);
    if (action) return action;
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
    expect(hasUniqueIds(state.deck)).toBe(true);
    expect(hasUniqueIds(inPlay)).toBe(true);
    // Modified and copied cards stay identical in the deck and in the hand / draw pile.
    for (const c of inPlay) expect(state.deck.find((d) => d.id === c.id)).toEqual(c);
    expect(state.deck.length).toBeGreaterThanOrEqual(config.minDeckSize);
    // Copies made by consumables can leave the hand over the limit, one card per copy at most.
    expect(state.hand.length).toBeLessThanOrEqual(config.handSize + state.nextCardNumber - 1);
    expect(state.consumables.length).toBeLessThanOrEqual(config.consumableSlots);
    expect(new Set(state.consumables.map((c) => c.instanceId)).size).toBe(state.consumables.length);
    expect(state.money).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(state.roundScore)).toBe(true);
  }
  return { state, actions };
}

describe('run properties', () => {
  it('replaying the action log gives the same final state and score (also across a save/load)', () => {
    let deepest = 0;
    let usedConsumables = 0;
    let runsWithCopies = 0;
    let runsWithScrap = 0;
    fc.assert(
      fc.property(fc.string(), fc.boolean(), fc.nat({ max: 60 }), (seed, gentle, saveLoadAt) => {
        const config = gentle ? GENTLE : DEFAULT_RUN_CONFIG;
        const { state, actions } = playRandomRun(seed, config, saveLoadAt);
        deepest = Math.max(deepest, state.ante);
        if (state.nextCardNumber > 1) runsWithCopies++;
        if (state.deck.length < 52 + state.nextCardNumber - 1) runsWithScrap++;
        usedConsumables += actions.filter((a) => a.type === 'applyConsumable').length;
        const replayed = replayRun({ seed, config, actions }).state;
        expect(replayed).toEqual(state);
        expect(replayed.bestHandScore).toBe(state.bestHandScore);
      }),
      // Fixed seed: the coverage counters below are deterministic, not a matter of luck in CI. If
      // the generator or the content changes and they fail, pick another seed that passes.
      { numRuns: 150, seed: 20261126 },
    );
    expect(deepest).toBeGreaterThanOrEqual(3);
    expect(usedConsumables).toBeGreaterThan(0);
    expect(runsWithCopies).toBeGreaterThan(0);
    expect(runsWithScrap).toBeGreaterThan(0);
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
