import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTENT,
  DEFAULT_RUN_CONFIG,
  createRun,
  hasUniqueIds,
  runReducer,
  type JokerDefinition,
  type RunAction,
  type RunConfig,
  type RunContent,
  type RunEvent,
  type RunState,
} from '../index';
import { deepFreeze } from '../testing/holdem-fixtures';

/** Any single card beats every blind. */
const EASY: RunConfig = { ...DEFAULT_RUN_CONFIG, anteTargets: [1, 1, 1, 1, 1, 1, 1, 1] };

function act(
  state: RunState,
  action: RunAction,
  content?: RunContent,
): { state: RunState; events: readonly RunEvent[] } {
  const result = runReducer(deepFreeze(state), action, content);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}`);
  return result;
}

const errorOf = (state: RunState, action: RunAction) => {
  const result = runReducer(state, action);
  if (result.ok) throw new Error('Expected the action to be rejected');
  return result.error.code;
};

const playFirst = (state: RunState, n = 1, content?: RunContent) =>
  act(state, { type: 'play', cardIds: state.hand.slice(0, n).map((c) => c.id) }, content);

describe('createRun', () => {
  it('starts at ante 1, small blind, with a full hand', () => {
    const { state, events } = createRun('seed');
    expect([state.status, state.phase, state.ante, state.blind]).toEqual([
      'in_progress',
      'blind',
      1,
      'small',
    ]);
    expect([
      state.hand.length,
      state.drawPile.length,
      state.handsLeft,
      state.discardsLeft,
      state.money,
      state.target,
    ]).toEqual([8, 44, 4, 3, 4, 250]);
    expect(events.map((e) => e.type)).toEqual(['blindStarted', 'cardsDrawn']);
    expect(DEFAULT_CONTENT.bosses.map((b) => b.id)).toContain(state.bossId);
  });

  it('is deterministic per seed', () => {
    expect(createRun('same').state).toEqual(createRun('same').state);
    expect(createRun('one').state.hand).not.toEqual(createRun('two').state.hand);
  });

  it('rejects configs without a target per ante', () => {
    expect(() => createRun('x', { ...DEFAULT_RUN_CONFIG, anteTargets: [1] })).toThrow(RangeError);
  });
});

describe('playing and discarding', () => {
  it('validates the selection', () => {
    const { state } = createRun('seed');
    const [a, b] = state.hand;
    expect(errorOf(state, { type: 'play', cardIds: [] })).toBe('INVALID_CARDS');
    expect(errorOf(state, { type: 'play', cardIds: state.hand.slice(0, 6).map((c) => c.id) })).toBe(
      'INVALID_CARDS',
    );
    expect(errorOf(state, { type: 'play', cardIds: [a!.id, a!.id] })).toBe('INVALID_CARDS');
    expect(errorOf(state, { type: 'play', cardIds: [b!.id, 'XX'] })).toBe('INVALID_CARDS');
    expect(errorOf(state, { type: 'buy', offerIndex: 0 })).toBe('INVALID_PHASE');
    expect(errorOf(state, { type: 'leaveShop' })).toBe('INVALID_PHASE');
  });

  it('playing scores, refills the hand and spends a hand', () => {
    const { state } = createRun('seed');
    const { state: next, events } = playFirst(state, 3);
    const scored = events.find((e) => e.type === 'handScored')!;
    expect(next.roundScore).toBe(scored.type === 'handScored' ? scored.score : -1);
    expect([next.handsLeft, next.hand.length, next.drawPile.length, next.handsPlayed]).toEqual([
      3, 8, 41, 1,
    ]);
    expect(hasUniqueIds([...next.hand, ...next.drawPile])).toBe(true);
  });

  it('discarding replaces cards and spends a discard', () => {
    let { state } = createRun('seed');
    for (let i = 0; i < 3; i++)
      state = act(state, { type: 'discard', cardIds: [state.hand[0]!.id] }).state;
    expect([state.discardsLeft, state.hand.length, state.drawPile.length]).toEqual([0, 8, 41]);
    expect(errorOf(state, { type: 'discard', cardIds: [state.hand[0]!.id] })).toBe(
      'NO_DISCARDS_LEFT',
    );
  });

  it('losing: out of hands below the target ends the run', () => {
    let { state } = createRun('seed', {
      ...DEFAULT_RUN_CONFIG,
      hands: 1,
      anteTargets: Array(8).fill(1e9),
    });
    const { state: lost, events } = playFirst(state);
    state = lost;
    expect([state.status, state.phase]).toEqual(['lost', 'ended']);
    expect(events.at(-1)).toEqual({ type: 'runLost' });
    expect(errorOf(state, { type: 'abandon' })).toBe('RUN_OVER');
  });

  it('abandoning ends the run', () => {
    const { state } = act(createRun('seed').state, { type: 'abandon' });
    expect(state.status).toBe('abandoned');
  });
});

describe('rounds, rewards and shop', () => {
  it('beating a blind pays reward + hands left + interest and opens the shop', () => {
    const { state, events } = playFirst(createRun('seed', { ...EASY, startingMoney: 12 }).state);
    // reward 3 + 3 hands left × $1 + interest floor(12 / 5) = 2.
    expect(events).toContainEqual({
      type: 'roundWon',
      blindReward: 3,
      handsLeftBonus: 3,
      interest: 2,
      money: 20,
    });
    expect([state.phase, state.blind, state.money]).toEqual(['shop', 'big', 20]);
    expect(state.shop.map((o) => o.kind)).toEqual(['joker', 'joker', 'levelUp']);
  });

  it('interest is capped', () => {
    const { events } = playFirst(createRun('seed', { ...EASY, startingMoney: 100 }).state);
    expect(events).toContainEqual(expect.objectContaining({ type: 'roundWon', interest: 4 }));
  });

  it('buy, sell and reorder jokers; level up a hand', () => {
    let state = playFirst(createRun('shop', { ...EASY, startingMoney: 50 }).state).state;
    state = act(state, { type: 'buy', offerIndex: 0 }).state;
    state = act(state, { type: 'buy', offerIndex: 1 }).state;
    state = act(state, { type: 'buy', offerIndex: 2 }).state;
    expect(state.jokers.map((j) => j.instanceId)).toEqual(['j1', 'j2']);
    expect(Object.values(state.handLevels).filter((l) => l === 2)).toHaveLength(1);
    expect(errorOf(state, { type: 'buy', offerIndex: 0 })).toBe('INVALID_OFFER');
    expect(errorOf(state, { type: 'buy', offerIndex: 9 })).toBe('INVALID_OFFER');

    state = act(state, { type: 'moveJoker', from: 0, to: 1 }).state;
    expect(state.jokers.map((j) => j.instanceId)).toEqual(['j2', 'j1']);
    expect(errorOf(state, { type: 'moveJoker', from: 0, to: 5 })).toBe('INVALID_JOKER');

    const before = state.money;
    const soldCost = DEFAULT_CONTENT.jokers.find((j) => j.id === state.jokers[0]!.jokerId)!.cost;
    state = act(state, { type: 'sellJoker', instanceId: 'j2' }).state;
    expect(state.money).toBe(before + Math.floor(soldCost / 2));
    expect(errorOf(state, { type: 'sellJoker', instanceId: 'j2' })).toBe('INVALID_JOKER');

    state = act(state, { type: 'leaveShop' }).state;
    expect([state.phase, state.blind, state.target, state.handsLeft]).toEqual([
      'blind',
      'big',
      1,
      4,
    ]);
    expect(errorOf(state, { type: 'sellJoker', instanceId: 'j1' })).toBe('INVALID_PHASE');
  });

  it('money and slots are enforced', () => {
    const poor = playFirst(
      createRun('shop', {
        ...EASY,
        startingMoney: 0,
        blindReward: { small: 0, big: 0, boss: 0 },
        moneyPerHandLeft: 0,
      }).state,
    ).state;
    expect(errorOf(poor, { type: 'buy', offerIndex: 0 })).toBe('NOT_ENOUGH_MONEY');
    const oneSlot = act(
      playFirst(createRun('shop', { ...EASY, startingMoney: 50, jokerSlots: 1 }).state).state,
      { type: 'buy', offerIndex: 0 },
    ).state;
    expect(errorOf(oneSlot, { type: 'buy', offerIndex: 1 })).toBe('NO_JOKER_SLOT');
  });

  it('economy joker pays at the end of each round won', () => {
    const content: RunContent = {
      ...DEFAULT_CONTENT,
      jokers: DEFAULT_CONTENT.jokers.filter((j) => j.id === 'piggy_bank'),
    };
    let state = playFirst(
      createRun('pig', { ...EASY, startingMoney: 10 }, content).state,
      1,
      content,
    ).state;
    state = act(state, { type: 'buy', offerIndex: 0 }, content).state; // the only joker in the pool
    state = act(state, { type: 'leaveShop' }, content).state;
    const before = state.money;
    const { events } = playFirst(state, 1, content);
    expect(events).toContainEqual({
      type: 'jokerTriggered',
      instanceId: 'j1',
      hook: 'onRoundEnd',
      effect: { money: 3 },
    });
    const won = events.find((e) => e.type === 'roundWon');
    // +3 from the joker, then reward 4 (big) + 3 hands left + interest on the money after the joker.
    expect(won).toEqual({
      type: 'roundWon',
      blindReward: 4,
      handsLeftBonus: 3,
      interest: Math.min(4, Math.floor((before + 3) / 5)),
      money: expect.any(Number),
    });
  });

  it('discard and shop-enter hooks run for custom jokers', () => {
    const custom: JokerDefinition = {
      id: 'collector',
      rarity: 'common',
      cost: 1,
      initialState: { discards: 0 },
      onDiscard: (self, ctx) => ({
        money: ctx.discarded.length,
        state: { discards: (self.state.discards ?? 0) + 1 },
      }),
      onShopEnter: () => ({ money: 10 }),
    };
    const content: RunContent = { ...DEFAULT_CONTENT, jokers: [custom] };
    let state = playFirst(createRun('hooks', EASY, content).state, 1, content).state;
    state = act(state, { type: 'buy', offerIndex: 0 }, content).state;
    state = act(state, { type: 'leaveShop' }, content).state;
    const money = state.money;
    state = act(
      state,
      { type: 'discard', cardIds: state.hand.slice(0, 2).map((c) => c.id) },
      content,
    ).state;
    expect(state.money).toBe(money + 2);
    expect(state.jokers[0]!.state).toEqual({ discards: 1 });
    const { events } = playFirst(state, 1, content);
    expect(events).toContainEqual({
      type: 'jokerTriggered',
      instanceId: 'j1',
      hook: 'onShopEnter',
      effect: { money: 10 },
    });
  });
});

describe('progression', () => {
  it('goes small → big → boss through 8 antes and wins after the last boss', () => {
    let state = createRun('long', EASY).state;
    const seen: string[] = [];
    while (state.status === 'in_progress') {
      seen.push(`${state.ante}-${state.blind}`);
      state = playFirst(state).state;
      if (state.phase === 'shop') state = act(state, { type: 'leaveShop' }).state;
    }
    expect(state.status).toBe('won');
    expect(seen).toHaveLength(24);
    expect(seen.slice(0, 4)).toEqual(['1-small', '1-big', '1-boss', '2-small']);
  });

  it('boss rules come from data', () => {
    const content: RunContent = {
      ...DEFAULT_CONTENT,
      bosses: [{ id: 'test', handsDelta: -2, discardsDelta: -99, debuffSuit: 'h' }],
    };
    let state = createRun('boss', EASY, content).state;
    for (let i = 0; i < 2; i++) {
      state = playFirst(state, 1, content).state;
      state = act(state, { type: 'leaveShop' }, content).state;
    }
    expect([state.blind, state.bossId, state.handsLeft, state.discardsLeft]).toEqual([
      'boss',
      'test',
      2,
      0,
    ]);
  });

  it('buying in the shop does not change the cards dealt next (independent PRNG streams)', () => {
    const atShop = playFirst(createRun('streams', { ...EASY, startingMoney: 50 }).state).state;
    const bought = act(act(atShop, { type: 'buy', offerIndex: 0 }).state, {
      type: 'leaveShop',
    }).state;
    const skipped = act(atShop, { type: 'leaveShop' }).state;
    expect(bought.hand).toEqual(skipped.hand);
    expect(bought.drawPile).toEqual(skipped.drawPile);
  });
});
