import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTENT,
  DEFAULT_RUN_CONFIG,
  RUN_STATE_VERSION,
  consumableSellValue,
  createRun,
  hasUniqueIds,
  isCardDebuffed,
  previewPlay,
  replayRun,
  runReducer,
  type ConsumableDefinition,
  type JokerDefinition,
  type RunAction,
  type RunCard,
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

  it('discarding the last cards of the hand with nothing left to draw ends the run as lost', () => {
    const s0 = createRun('lock').state;
    const deck = s0.deck.slice(0, 30);
    const stuck: RunState = {
      ...s0,
      deck,
      drawPile: [],
      hand: deck.slice(0, 3),
      handsLeft: 2,
      discardsLeft: 1,
    };
    const { state, events } = act(stuck, { type: 'discard', cardIds: stuck.hand.map((c) => c.id) });
    expect([state.status, state.phase, state.hand.length]).toEqual(['lost', 'ended', 0]);
    expect(events.at(-1)).toEqual({ type: 'runLost' });
    // A discard that still leaves cards in hand keeps the run going.
    const fine = act(stuck, { type: 'discard', cardIds: [stuck.hand[0]!.id] }).state;
    expect(fine.status).toBe('in_progress');
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
    expect(state.shop.map((o) => o.kind)).toEqual([
      'joker',
      'joker',
      'consumable',
      'consumable',
      'pack',
      'pack',
      'voucher',
    ]);
    const [, , a, b] = state.shop;
    expect(
      a?.kind === 'consumable' && b?.kind === 'consumable' && a.consumableId !== b.consumableId,
    ).toBe(true);
    for (const offer of [a, b]) {
      if (offer?.kind !== 'consumable') throw new Error('Expected a consumable offer');
      const def = DEFAULT_CONTENT.consumables.find((c) => c.id === offer.consumableId)!;
      expect(offer).toMatchObject({ price: def.cost, sold: false });
    }
  });

  it('keeps the joker draw order of the shop sub-stream (consumables are drawn after)', () => {
    // Recorded before consumables existed: the e2e seed depends on these two staying put.
    const { state } = playFirst(createRun('seed', { ...EASY, startingMoney: 12 }).state);
    expect(state.shop.slice(0, 2)).toEqual([
      { kind: 'joker', jokerId: 'tip_jar', price: 4, sold: false },
      { kind: 'joker', jokerId: 'ember', price: 4, sold: false },
    ]);
  });

  it('interest is capped', () => {
    const { events } = playFirst(createRun('seed', { ...EASY, startingMoney: 100 }).state);
    expect(events).toContainEqual(expect.objectContaining({ type: 'roundWon', interest: 4 }));
  });

  it('buy, sell and reorder jokers', () => {
    let state = playFirst(createRun('shop', { ...EASY, startingMoney: 50 }).state).state;
    state = act(state, { type: 'buy', offerIndex: 0 }).state;
    state = act(state, { type: 'buy', offerIndex: 1 }).state;
    expect(state.jokers.map((j) => j.instanceId)).toEqual(['j1', 'j2']);
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

  describe('consumable purchase', () => {
    const shopWith = (config: Partial<RunConfig> = {}) =>
      playFirst(createRun('shop', { ...EASY, startingMoney: 50, ...config }).state).state;
    const consumableOffer = (state: RunState, index: number) => {
      const offer = state.shop[index];
      if (offer?.kind !== 'consumable') throw new Error('Expected a consumable offer');
      return offer;
    };

    it('adds it to the inventory and charges the exact price', () => {
      const atShop = shopWith();
      const offer = consumableOffer(atShop, 2);
      const { state, events } = act(atShop, { type: 'buy', offerIndex: 2 });
      expect(state.consumables).toEqual([{ instanceId: 'c1', consumableId: offer.consumableId }]);
      expect(state.money).toBe(atShop.money - offer.price);
      expect(state.shop[2]).toEqual({ ...offer, sold: true });
      expect(events).toEqual([{ type: 'bought', offerIndex: 2, money: state.money }]);
      const second = act(state, { type: 'buy', offerIndex: 3 }).state;
      expect(second.consumables.map((c) => c.instanceId)).toEqual(['c1', 'c2']);
    });

    it('fails with NO_CONSUMABLE_SLOT when the inventory is full and changes nothing', () => {
      const bought = act(shopWith({ consumableSlots: 1 }), { type: 'buy', offerIndex: 2 }).state;
      const before = JSON.stringify(bought);
      const result = runReducer(bought, { type: 'buy', offerIndex: 3 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NO_CONSUMABLE_SLOT');
      expect(JSON.stringify(bought)).toBe(before);
      expect(bought.shop[3]).toMatchObject({ sold: false });
    });

    it('needs exactly the price: enough money passes, one less fails', () => {
      const atShop = shopWith();
      const { price } = consumableOffer(atShop, 2);
      const exact = act({ ...atShop, money: price }, { type: 'buy', offerIndex: 2 }).state;
      expect(exact.money).toBe(0);
      expect(errorOf({ ...atShop, money: price - 1 }, { type: 'buy', offerIndex: 2 })).toBe(
        'NOT_ENOUGH_MONEY',
      );
    });

    it('sells for half the price, rounded down, at least $1', () => {
      const withCost = (cost: number): RunContent => ({
        ...DEFAULT_CONTENT,
        consumables: [{ ...DEFAULT_CONTENT.consumables[0]!, id: 'x', cost }],
      });
      const instance = { instanceId: 'c1', consumableId: 'x' };
      expect(consumableSellValue(instance, withCost(3))).toBe(1);
      expect(consumableSellValue(instance, withCost(5))).toBe(2);
      expect(consumableSellValue(instance, withCost(1))).toBe(1);
      expect(consumableSellValue({ instanceId: 'c1', consumableId: 'unknown' })).toBe(1);
    });
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

describe('MVP content and shop', () => {
  it('ships 20 jokers and 5 bosses with unique ids', () => {
    expect(DEFAULT_CONTENT.jokers).toHaveLength(20);
    expect(DEFAULT_CONTENT.bosses).toHaveLength(5);
    expect(new Set(DEFAULT_CONTENT.jokers.map((j) => j.id)).size).toBe(20);
  });

  it('reroll costs more each time in the same shop and resets in the next one', () => {
    let state = playFirst(createRun('reroll', { ...EASY, startingMoney: 40 }).state).state;
    const money = state.money;
    const first = act(state, { type: 'reroll' });
    expect(first.events).toContainEqual(
      expect.objectContaining({ type: 'shopRerolled', nextCost: 4 }),
    );
    state = act(first.state, { type: 'reroll' }).state;
    expect([state.money, state.rerollCost]).toEqual([money - 3 - 4, 5]);
    state = act(state, { type: 'leaveShop' }).state;
    state = playFirst(state).state;
    expect(state.rerollCost).toBe(3);
    const broke = { ...state, money: 2 };
    expect(errorOf(broke, { type: 'reroll' })).toBe('NOT_ENOUGH_MONEY');
    expect(errorOf(createRun('x').state, { type: 'reroll' })).toBe('INVALID_PHASE');
  });

  it('sorts the hand by rank or suit', () => {
    const { state } = createRun('sort');
    const byRank = act(state, { type: 'sortHand', by: 'rank' }).state.hand.map((c) => c.rank);
    expect(byRank).toEqual([...byRank].sort((a, b) => b - a));
    const bySuit = act(state, { type: 'sortHand', by: 'suit' }).state.hand.map((c) => c.suit);
    const order = ['s', 'h', 'd', 'c'];
    expect(bySuit).toEqual([...bySuit].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  });

  it('previews the hand type and base score without playing', () => {
    const { state } = createRun('preview');
    const [a] = state.hand;
    const preview = previewPlay(state, [a!.id]);
    expect(preview).toEqual({
      handType: 'high_card',
      level: 1,
      chips: 5,
      mult: 1,
      scoringIds: [a!.id],
    });
    expect(previewPlay(state, [])).toBeNull();
    expect(previewPlay(state, ['XX'])).toBeNull();
  });

  it('boss "press" shrinks the hand and "mask" debuffs face cards', () => {
    const toBoss = (bossId: string) => {
      const content: RunContent = {
        ...DEFAULT_CONTENT,
        bosses: DEFAULT_CONTENT.bosses.filter((b) => b.id === bossId),
      };
      let state = createRun('boss', EASY, content).state;
      for (let i = 0; i < 2; i++) {
        state = playFirst(state, 1, content).state;
        state = act(state, { type: 'leaveShop' }, content).state;
      }
      return { state, content };
    };
    const press = toBoss('press').state;
    expect([press.blind, press.handSize, press.hand.length]).toEqual(['boss', 7, 7]);
    const { state: mask, content } = toBoss('mask');
    const face = mask.deck.find((c) => c.rank === 12)!;
    expect(isCardDebuffed(mask, face, content)).toBe(true);
    expect(
      isCardDebuffed(
        mask,
        mask.deck.find((c) => c.rank === 9)!,
        content,
      ),
    ).toBe(false);
  });

  it('saved states carry the schema version', () => {
    expect(createRun('v').state.version).toBe(RUN_STATE_VERSION);
    expect(RUN_STATE_VERSION).toBe(3);
  });

  it('starts with an empty inventory and counters at 1', () => {
    const { state } = createRun('inv');
    expect([state.consumables, state.nextConsumableNumber, state.nextCardNumber]).toEqual([
      [],
      1,
      1,
    ]);
    expect([state.config.consumableSlots, state.config.minDeckSize]).toEqual([2, 20]);
  });
});

describe('applying and selling consumables', () => {
  const inventory = (state: RunState, ...consumableIds: string[]): RunState => ({
    ...state,
    consumables: consumableIds.map((consumableId, i) => ({
      instanceId: `c${i + 1}`,
      consumableId,
    })),
  });
  /** Same state, with card `id` changed in both the hand and the deck (as a consumable would). */
  const patchCard = (state: RunState, id: string, patch: Partial<RunCard>): RunState => {
    const swap = (cards: readonly RunCard[]) =>
      cards.map((c) => (c.id === id ? { ...c, ...patch } : c));
    return { ...state, hand: swap(state.hand), deck: swap(state.deck) };
  };
  const inBlind = () => createRun('consume').state;
  const inShop = () => playFirst(createRun('consume', EASY).state).state;
  const errorCode = (state: RunState, action: RunAction, content?: RunContent) => {
    const result = runReducer(deepFreeze(state), action, content);
    if (result.ok) throw new Error('Expected the action to be rejected');
    return result.error.code;
  };
  const use = (instanceId: string, ...cardIds: string[]): RunAction => ({
    type: 'applyConsumable',
    instanceId,
    cardIds,
  });
  const withContent = (...consumables: ConsumableDefinition[]): RunContent => ({
    ...DEFAULT_CONTENT,
    consumables,
  });

  describe('studies (no targets)', () => {
    it('raise that hand type by one level in the shop and free the slot', () => {
      const state = inventory(inShop(), 'study_pair');
      const { state: next, events } = act(state, { type: 'applyConsumable', instanceId: 'c1' });
      expect(next.handLevels.pair).toBe(state.handLevels.pair + 1);
      expect(next.handLevels.flush).toBe(state.handLevels.flush);
      expect(next.consumables).toEqual([]);
      expect(events).toEqual([
        { type: 'consumableUsed', instanceId: 'c1', consumableId: 'study_pair', cardIds: [] },
      ]);
    });

    it('also work during a blind', () => {
      const state = inventory(inBlind(), 'study_flush', 'study_pair');
      const { state: next } = act(state, {
        type: 'applyConsumable',
        instanceId: 'c1',
        cardIds: [],
      });
      expect(next.handLevels.flush).toBe(2);
      expect(next.consumables).toEqual([{ instanceId: 'c2', consumableId: 'study_pair' }]);
    });

    it('reject cards with INVALID_CARDS', () => {
      const state = inventory(inBlind(), 'study_pair');
      expect(errorCode(state, use('c1', state.hand[0]!.id))).toBe('INVALID_CARDS');
    });
  });

  describe('card consumables', () => {
    it('paint_h changes the suit in the hand and in the deck and keeps the ids', () => {
      const base = inventory(inBlind(), 'paint_h');
      const ids = base.hand
        .filter((c) => c.suit !== 'h')
        .slice(0, 2)
        .map((c) => c.id);
      const { state, events } = act(base, use('c1', ...ids));
      for (const id of ids) {
        expect(state.hand.find((c) => c.id === id)?.suit).toBe('h');
        expect(state.deck.find((c) => c.id === id)?.suit).toBe('h');
      }
      expect(state.hand.map((c) => c.id)).toEqual(base.hand.map((c) => c.id));
      expect(state.deck.map((c) => c.id)).toEqual(base.deck.map((c) => c.id));
      expect(state.hand.map((c) => c.rank)).toEqual(base.hand.map((c) => c.rank));
      expect(state.hand.filter((c) => !ids.includes(c.id))).toEqual(
        base.hand.filter((c) => !ids.includes(c.id)),
      );
      expect(state.consumables).toEqual([]);
      expect(events).toEqual([
        { type: 'consumableUsed', instanceId: 'c1', consumableId: 'paint_h', cardIds: ids },
      ]);
    });

    it('reinforce marks the card and it scores +25 chips more when played', () => {
      const base = inventory(inBlind(), 'reinforce');
      const id = base.hand[0]!.id;
      const chipsOf = (state: RunState) => {
        const { events } = act(state, { type: 'play', cardIds: [id] });
        const scored = events.find((e) => e.type === 'handScored');
        if (scored?.type !== 'handScored') throw new Error('No hand scored');
        return scored.chips;
      };
      const { state } = act(base, use('c1', id));
      expect(state.hand.find((c) => c.id === id)?.enhancement).toBe('reinforced');
      expect(state.deck.find((c) => c.id === id)?.enhancement).toBe('reinforced');
      expect(chipsOf(state)).toBe(chipsOf(base) + 25);
    });

    it('elevate turns a 9 into a 10 and keeps the id', () => {
      const base = inventory(inBlind(), 'elevate');
      const id = base.hand[0]!.id;
      const { state } = act(patchCard(base, id, { rank: 9 }), use('c1', id));
      expect(state.hand.find((c) => c.id === id)?.rank).toBe(10);
      expect(state.deck.find((c) => c.id === id)?.rank).toBe(10);
    });

    it('elevate on an Ace fails with INVALID_CARDS and changes nothing', () => {
      const base = inventory(inBlind(), 'elevate');
      const [five, ace] = [base.hand[0]!.id, base.hand[1]!.id];
      const state = patchCard(patchCard(base, five, { rank: 5 }), ace, { rank: 14 });
      const before = JSON.stringify(state);
      expect(errorCode(state, use('c1', ace))).toBe('INVALID_CARDS');
      // The valid card goes first: the failed action must not leak its change.
      expect(errorCode(state, use('c1', five, ace))).toBe('INVALID_CARDS');
      expect(JSON.stringify(state)).toBe(before);
    });

    it('a shiftRank of -1 on a 2 fails with INVALID_CARDS', () => {
      const lower: ConsumableDefinition = {
        id: 'lower',
        cost: 3,
        targets: { min: 1, max: 1 },
        ops: [{ op: 'shiftRank', delta: -1 }],
      };
      const content = withContent(lower);
      const base = inventory(inBlind(), 'lower');
      const id = base.hand[0]!.id;
      expect(errorCode(patchCard(base, id, { rank: 2 }), use('c1', id), content)).toBe(
        'INVALID_CARDS',
      );
      const { state } = act(patchCard(base, id, { rank: 5 }), use('c1', id), content);
      expect(state.hand.find((c) => c.id === id)?.rank).toBe(4);
    });

    it('applies the operations of a consumable in order', () => {
      const combo: ConsumableDefinition = {
        id: 'combo',
        cost: 3,
        targets: { min: 1, max: 1 },
        ops: [
          { op: 'shiftRank', delta: 2 },
          { op: 'changeSuit', suit: 'c' },
          { op: 'enhanceCards', enhancement: 'reinforced' },
        ],
      };
      const base = inventory(inBlind(), 'combo');
      const id = base.hand[0]!.id;
      const { state } = act(
        patchCard(base, id, { rank: 5, suit: 's' }),
        use('c1', id),
        withContent(combo),
      );
      expect(state.hand.find((c) => c.id === id)).toMatchObject({
        id,
        rank: 7,
        suit: 'c',
        enhancement: 'reinforced',
      });
    });

    it('an unknown enhancement is INVALID_CONSUMABLE', () => {
      const broken: ConsumableDefinition = {
        id: 'broken',
        cost: 3,
        targets: { min: 1, max: 1 },
        ops: [{ op: 'enhanceCards', enhancement: 'nope' }],
      };
      const base = inventory(inBlind(), 'broken');
      expect(errorCode(base, use('c1', base.hand[0]!.id), withContent(broken))).toBe(
        'INVALID_CONSUMABLE',
      );
    });

    it('validates the selected cards', () => {
      const base = inventory(inBlind(), 'paint_s'); // 1 to 3 cards
      const [a, b, c, d] = base.hand.map((x) => x.id) as [string, string, string, string];
      expect(errorCode(base, use('c1'))).toBe('INVALID_CARDS');
      expect(errorCode(base, { type: 'applyConsumable', instanceId: 'c1' })).toBe('INVALID_CARDS');
      expect(errorCode(base, use('c1', a, b, c, d))).toBe('INVALID_CARDS');
      expect(errorCode(base, use('c1', a, a))).toBe('INVALID_CARDS');
      expect(errorCode(base, use('c1', a, 'XX'))).toBe('INVALID_CARDS');
      // In the deck but not in the hand (it is in the draw pile).
      expect(errorCode(base, use('c1', base.drawPile[0]!.id))).toBe('INVALID_CARDS');
      expect(act(base, use('c1', a, b, c)).state.consumables).toEqual([]);
    });

    it('cannot be used in the shop', () => {
      const state = inventory(inShop(), 'paint_s');
      expect(errorCode(state, use('c1', state.deck[0]!.id))).toBe('INVALID_PHASE');
      expect(errorCode(state, { type: 'applyConsumable', instanceId: 'c1' })).toBe('INVALID_PHASE');
    });
  });

  it('an unknown instance is INVALID_CONSUMABLE', () => {
    const state = inventory(inBlind(), 'study_pair');
    expect(errorCode(state, { type: 'applyConsumable', instanceId: 'c9' })).toBe(
      'INVALID_CONSUMABLE',
    );
    expect(errorCode(state, { type: 'sellConsumable', instanceId: 'c9' })).toBe(
      'INVALID_CONSUMABLE',
    );
  });

  it('an instance whose definition is not in the content is INVALID_CONSUMABLE', () => {
    const state = inventory(inBlind(), 'ghost');
    expect(errorCode(state, { type: 'applyConsumable', instanceId: 'c1' })).toBe(
      'INVALID_CONSUMABLE',
    );
  });

  it('a failing operation after a successful one leaves the state intact', () => {
    const broken: ConsumableDefinition = {
      id: 'broken_combo',
      cost: 3,
      targets: { min: 1, max: 1 },
      ops: [
        { op: 'levelUpHand', hand: 'pair' },
        { op: 'shiftRank', delta: 1 },
      ],
    };
    const base = inventory(inBlind(), 'broken_combo');
    const id = base.hand[0]!.id;
    const state = deepFreeze(patchCard(base, id, { rank: 14 }));
    const before = JSON.stringify(state);
    const result = runReducer(state, use('c1', id), withContent(broken));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_CARDS');
    expect(JSON.stringify(state)).toBe(before);
    expect(state.handLevels.pair).toBe(1);
    expect(state.consumables).toHaveLength(1);
  });

  it('asks for an exact number of cards in plain words', () => {
    const base = inventory(inBlind(), 'twin');
    const [a, b] = base.hand.map((c) => c.id) as [string, string];
    const result = runReducer(base, use('c1', a, b));
    if (result.ok) throw new Error('Expected the action to be rejected');
    expect(result.error.message).toBe('Select exactly 1 card from your hand');
  });

  it('copies the target ids into the consumableUsed event', () => {
    const base = inventory(inBlind(), 'paint_s');
    const id = base.hand[0]!.id;
    // Build the action once and keep a reference to the very array it carries.
    const action = use('c1', id);
    const actionIds = action.type === 'applyConsumable' ? action.cardIds : undefined;
    if (!actionIds) throw new Error('Expected an action with card ids');
    const { events } = act(base, action);
    const used = events.find((e) => e.type === 'consumableUsed');
    if (used?.type !== 'consumableUsed') throw new Error('No consumableUsed event');
    expect(used.cardIds).toEqual([id]);
    expect(used.cardIds).not.toBe(actionIds);
  });

  describe('destroying and duplicating cards', () => {
    const inEasyBlind = (...consumableIds: string[]) =>
      inventory(createRun('consume', EASY).state, ...consumableIds);
    const everywhere = (state: RunState) => [...state.deck, ...state.hand, ...state.drawPile];
    const piles = (state: RunState) => [...state.hand, ...state.drawPile];

    it('scrap on 2 cards shrinks the deck, refills the hand and the cards are gone for good', () => {
      const base = inventory(inBlind(), 'scrap');
      const ids = [base.hand[0]!.id, base.hand[1]!.id];
      const drawnIds = base.drawPile.slice(0, 2).map((c) => c.id);
      const { state, events } = act(base, use('c1', ...ids));
      expect(state.deck).toHaveLength(50);
      expect(state.hand).toHaveLength(state.handSize);
      expect(state.drawPile).toHaveLength(base.drawPile.length - 2);
      for (const id of ids) expect(everywhere(state).some((c) => c.id === id)).toBe(false);
      expect(state.hand.slice(-2).map((c) => c.id)).toEqual(drawnIds);
      expect(events).toEqual([
        { type: 'consumableUsed', instanceId: 'c1', consumableId: 'scrap', cardIds: ids },
        { type: 'cardsDrawn', cardIds: drawnIds },
      ]);
      expect(hasUniqueIds(piles(state))).toBe(true);
    });

    it('destroyed cards do not come back in the next blind', () => {
      const base = inEasyBlind('scrap');
      const id = base.hand[0]!.id;
      const afterScrap = act(base, use('c1', id)).state;
      const shop = playFirst(afterScrap).state;
      const next = act(shop, { type: 'leaveShop' }).state;
      expect(next.hand.length + next.drawPile.length).toBe(51);
      expect(everywhere(next).some((c) => c.id === id)).toBe(false);
    });

    it('fails with INVALID_CARDS when the deck would drop below minDeckSize, changing nothing', () => {
      const base = inventory(createRun('consume').state, 'scrap');
      const tight = deepFreeze({ ...base, config: { ...base.config, minDeckSize: 51 } });
      const before = JSON.stringify(tight);
      expect(errorCode(tight, use('c1', tight.hand[0]!.id, tight.hand[1]!.id))).toBe(
        'INVALID_CARDS',
      );
      expect(JSON.stringify(tight)).toBe(before);
      // One card still fits (52 - 1 = 51).
      expect(act(tight, use('c1', tight.hand[0]!.id)).state.deck).toHaveLength(51);
    });

    /** A thinned deck whose draw pile is already empty and with few cards left in hand. */
    const dryHand = (state: RunState, inHand: number): RunState => {
      const deck = state.deck.slice(0, 30);
      return { ...state, deck, drawPile: [], hand: deck.slice(0, inHand), handsLeft: 2 };
    };

    it('scrap is refused with WOULD_EMPTY_HAND when it would leave the hand empty, changing nothing', () => {
      const base = deepFreeze(inventory(dryHand(inBlind(), 2), 'scrap'));
      const before = JSON.stringify(base);
      expect(errorCode(base, use('c1', ...base.hand.map((c) => c.id)))).toBe('WOULD_EMPTY_HAND');
      expect(JSON.stringify(base)).toBe(before);
      // One card still leaves a card in hand.
      const { state } = act(base, use('c1', base.hand[0]!.id));
      expect(state.hand).toHaveLength(1);
      expect(state.status).toBe('in_progress');
    });

    it('destroying the whole hand deals a completely new one', () => {
      const wipe: ConsumableDefinition = {
        id: 'wipe',
        cost: 3,
        targets: { min: 1, max: 8 },
        ops: [{ op: 'destroyCards' }],
      };
      const base = inventory(inBlind(), 'wipe');
      const ids = base.hand.map((c) => c.id);
      const drawnIds = base.drawPile.slice(0, 8).map((c) => c.id);
      const { state, events } = act(base, use('c1', ...ids), withContent(wipe));
      expect(state.hand.map((c) => c.id)).toEqual(drawnIds);
      expect(state.deck).toHaveLength(44);
      expect(state.drawPile).toHaveLength(base.drawPile.length - 8);
      expect(events[1]).toEqual({ type: 'cardsDrawn', cardIds: drawnIds });
    });

    it('twin adds an exact copy with a new id to the deck and to the hand', () => {
      const base = inventory(inBlind(), 'twin');
      const id = base.hand[2]!.id;
      const patched = patchCard(base, id, { enhancement: 'reinforced' });
      const original = patched.hand[2]!;
      const { state, events } = act(patched, use('c1', id));
      expect(state.deck).toHaveLength(53);
      expect(state.hand).toHaveLength(9);
      expect(state.nextCardNumber).toBe(2);
      const copy = state.hand.at(-1)!;
      expect(copy).toEqual({ ...original, id: 'x1' });
      expect(copy.enhancement).toBe('reinforced');
      expect(state.deck.at(-1)).toEqual(copy);
      expect(state.hand.find((c) => c.id === id)).toEqual(original);
      expect(state.drawPile).toEqual(patched.drawPile);
      expect(events).toEqual([
        { type: 'consumableUsed', instanceId: 'c1', consumableId: 'twin', cardIds: [id] },
      ]);
    });

    it('a second twin creates x2 and the ids stay unique', () => {
      const base = inventory(inBlind(), 'twin', 'twin');
      const first = act(base, use('c1', base.hand[0]!.id)).state;
      const second = act(first, use('c2', first.hand[0]!.id)).state;
      expect(second.hand.slice(-2).map((c) => c.id)).toEqual(['x1', 'x2']);
      expect(second.nextCardNumber).toBe(3);
      expect(second.deck).toHaveLength(54);
      expect(hasUniqueIds(second.deck)).toBe(true);
      expect(hasUniqueIds(piles(second))).toBe(true);
    });

    it('a copy can be played, and the next blind shuffles all 53 cards', () => {
      const base = inEasyBlind('twin');
      const afterTwin = act(base, use('c1', base.hand[0]!.id)).state;
      const { state: shop, events } = act(afterTwin, { type: 'play', cardIds: ['x1'] });
      expect(events.find((e) => e.type === 'handScored')).toMatchObject({ playedIds: ['x1'] });
      expect(shop.phase).toBe('shop');
      const next = act(shop, { type: 'leaveShop' }).state;
      expect(next.hand.length + next.drawPile.length).toBe(53);
      expect(next.hand).toHaveLength(next.handSize);
      expect(hasUniqueIds(piles(next))).toBe(true);
      expect(piles(next).some((c) => c.id === 'x1')).toBe(true);
    });

    it('does not refill the hand beyond handSize after a copy', () => {
      const base = inventory(inBlind(), 'twin');
      const afterTwin = act(base, use('c1', base.hand[0]!.id)).state;
      const { state } = act(afterTwin, { type: 'discard', cardIds: [afterTwin.hand[1]!.id] });
      expect(state.hand).toHaveLength(8);
    });
  });

  describe('selling', () => {
    it('in a blind adds the sell value and removes the instance', () => {
      const base = inventory(inBlind(), 'paint_s', 'study_pair');
      const { state, events } = act(base, { type: 'sellConsumable', instanceId: 'c2' });
      const value = consumableSellValue(base.consumables[1]!);
      expect(value).toBe(1);
      expect(state.money).toBe(base.money + value);
      expect(state.consumables).toEqual([{ instanceId: 'c1', consumableId: 'paint_s' }]);
      expect(events).toEqual([{ type: 'consumableSold', instanceId: 'c2', money: state.money }]);
    });

    it('works in the shop too', () => {
      const base = inventory(inShop(), 'study_pair');
      const { state } = act(base, { type: 'sellConsumable', instanceId: 'c1' });
      expect(state.money).toBe(base.money + 1);
      expect(state.consumables).toEqual([]);
    });

    it('selling the same instance twice fails', () => {
      const once = act(inventory(inBlind(), 'study_pair'), {
        type: 'sellConsumable',
        instanceId: 'c1',
      }).state;
      expect(errorCode(once, { type: 'sellConsumable', instanceId: 'c1' })).toBe(
        'INVALID_CONSUMABLE',
      );
    });
  });

  it('both actions fail with RUN_OVER once the run has ended', () => {
    const over = act(inventory(inBlind(), 'study_pair'), { type: 'abandon' }).state;
    expect(errorCode(over, { type: 'applyConsumable', instanceId: 'c1' })).toBe('RUN_OVER');
    expect(errorCode(over, { type: 'sellConsumable', instanceId: 'c1' })).toBe('RUN_OVER');
  });
});

describe('save/load with card-changing consumables', () => {
  it('keeps playing after a JSON round trip and replays to the same state', () => {
    // Exactly paint, twin and scrap in the pool, three offers: the shop always sells all three.
    const content: RunContent = {
      ...DEFAULT_CONTENT,
      consumables: DEFAULT_CONTENT.consumables.filter((c) =>
        ['paint_h', 'twin', 'scrap'].includes(c.id),
      ),
    };
    const config: RunConfig = {
      ...EASY,
      startingMoney: 50,
      consumableSlots: 3,
      shopConsumableOffers: 3,
    };
    const actions: RunAction[] = [];
    const step = (state: RunState, action: RunAction) => {
      actions.push(action);
      return act(state, action, content).state;
    };

    let state = createRun('save-load', config, content).state;
    state = step(state, { type: 'play', cardIds: [state.hand[0]!.id] });
    expect(state.phase).toBe('shop');
    state.shop.forEach((offer, i) => {
      if (offer.kind === 'consumable') state = step(state, { type: 'buy', offerIndex: i });
    });
    expect(state.consumables.map((c) => c.consumableId).sort()).toEqual([
      'paint_h',
      'scrap',
      'twin',
    ]);
    state = step(state, { type: 'leaveShop' });

    const instanceOf = (id: string) =>
      state.consumables.find((c) => c.consumableId === id)!.instanceId;
    state = step(state, {
      type: 'applyConsumable',
      instanceId: instanceOf('paint_h'),
      cardIds: [state.hand[0]!.id],
    });
    state = step(state, {
      type: 'applyConsumable',
      instanceId: instanceOf('twin'),
      cardIds: [state.hand[1]!.id],
    });
    state = step(state, {
      type: 'applyConsumable',
      instanceId: instanceOf('scrap'),
      cardIds: [state.hand[2]!.id],
    });
    expect(state.nextCardNumber).toBe(2);
    expect(state.deck).toHaveLength(52);

    // Save + load, then keep playing from the loaded state.
    state = JSON.parse(JSON.stringify(state)) as RunState;
    expect(hasUniqueIds([...state.hand, ...state.drawPile])).toBe(true);
    state = step(state, { type: 'play', cardIds: [state.hand[0]!.id] });
    expect(hasUniqueIds([...state.hand, ...state.drawPile])).toBe(true);
    expect(hasUniqueIds(state.deck)).toBe(true);

    expect(replayRun({ seed: 'save-load', config, actions }, content).state).toEqual(state);
  });
});

describe('packs and vouchers in the shop', () => {
  const atShop = (seed = 'shop', config: Partial<RunConfig> = {}) =>
    playFirst(createRun(seed, { ...EASY, startingMoney: 50, ...config }).state).state;

  it('lays out jokers, consumables, two packs and one voucher', () => {
    const { shop } = atShop();
    expect(shop.map((o) => o.kind)).toEqual([
      'joker',
      'joker',
      'consumable',
      'consumable',
      'pack',
      'pack',
      'voucher',
    ]);
    const packs = shop.filter((o) => o.kind === 'pack');
    expect(new Set(packs.map((o) => (o.kind === 'pack' ? o.packId : ''))).size).toBe(2);
    for (const offer of shop) {
      const cost =
        offer.kind === 'pack'
          ? DEFAULT_CONTENT.packs.find((p) => p.id === offer.packId)?.cost
          : offer.kind === 'voucher'
            ? DEFAULT_CONTENT.vouchers.find((v) => v.id === offer.voucherId)?.cost
            : offer.price;
      expect(offer.price).toBe(cost);
      expect(offer.sold).toBe(false);
    }
  });

  it('leaves the joker and consumable draws exactly as before', () => {
    const ids = (seed: string) =>
      atShop(seed)
        .shop.slice(0, 4)
        .map((o) =>
          o.kind === 'joker' ? o.jokerId : o.kind === 'consumable' ? o.consumableId : o.kind,
        );
    expect(ids('shop')).toEqual(['steady_hand', 'tip_jar', 'study_flush', 'paint_d']);
    expect(ids('E2E-9')).toEqual([
      'minimalist',
      'rough_diamond',
      'study_straight_flush',
      'paint_h',
    ]);
    const first = atShop('E2E-9').shop[0];
    expect(first).toMatchObject({ kind: 'joker', jokerId: 'minimalist', price: 6 });
  });

  it('sorts packs and vouchers from the pack stream only', () => {
    const before = createRun('shop', { ...EASY, startingMoney: 50 }).state;
    const after = atShop();
    expect(after.rng.pack).not.toEqual(before.rng.pack);
    const rerolled = act(after, { type: 'reroll' }).state;
    expect(rerolled.rng.pack).toEqual(after.rng.pack);
    expect(rerolled.rng.shop).not.toEqual(after.rng.shop);
  });

  it('reroll keeps the packs and the voucher and only changes jokers and consumables', () => {
    const shop = atShop();
    const rerolled = act(shop, { type: 'reroll' }).state;
    expect(rerolled.shop.slice(4)).toEqual(shop.shop.slice(4));
    expect(rerolled.shop.map((o) => o.kind)).toEqual(shop.shop.map((o) => o.kind));
  });

  it('offers no voucher when none are left in the catalog', () => {
    const noVouchers: RunContent = { ...DEFAULT_CONTENT, vouchers: [] };
    const state = playFirst(
      createRun('shop', { ...EASY, startingMoney: 50 }, noVouchers).state,
      1,
      noVouchers,
    ).state;
    expect(state.shop.some((o) => o.kind === 'voucher')).toBe(false);
  });

  it('never offers a voucher that was already bought', () => {
    const all = DEFAULT_CONTENT.vouchers.map((v) => v.id);
    const created = createRun('shop', { ...EASY, startingMoney: 50 }).state;
    const state = playFirst({ ...created, vouchers: all }).state;
    expect(state.shop.some((o) => o.kind === 'voucher')).toBe(false);
    const partly = playFirst({ ...created, vouchers: all.slice(1) }).state;
    expect(partly.shop.filter((o) => o.kind === 'voucher')).toEqual([
      { kind: 'voucher', voucherId: all[0], price: DEFAULT_CONTENT.vouchers[0]!.cost, sold: false },
    ]);
  });

  it('starts with no vouchers, no open pack and a pack stream, in state version 3', () => {
    const { state } = createRun('x');
    expect(RUN_STATE_VERSION).toBe(3);
    expect([state.version, state.vouchers, state.openPack]).toEqual([3, [], null]);
    expect(state.rng.pack).toBeDefined();
  });
});

describe('vouchers', () => {
  const only = (
    id: string,
    modifiers?: RunContent['vouchers'][number]['modifiers'],
  ): RunContent => ({
    ...DEFAULT_CONTENT,
    vouchers: DEFAULT_CONTENT.vouchers
      .filter((v) => v.id === id)
      .map((v) => (modifiers ? { ...v, modifiers } : v)),
  });
  const shopWith = (
    id: string,
    config: Partial<RunConfig> = {},
    modifiers?: Parameters<typeof only>[1],
  ) => {
    const content = only(id, modifiers);
    const created = createRun('vouchers', { ...EASY, startingMoney: 50, ...config }, content).state;
    return { content, state: playFirst(created, 1, content).state };
  };
  const VOUCHER_INDEX = 6;
  const buyVoucher = (state: RunState, content: RunContent) =>
    act(state, { type: 'buy', offerIndex: VOUCHER_INDEX }, content);

  it('charges the exact price, marks the offer sold and records the voucher', () => {
    const { state, content } = shopWith('extra_hand');
    const bought = buyVoucher(state, content);
    expect(bought.state.money).toBe(state.money - 10);
    expect(bought.state.shop[VOUCHER_INDEX]).toMatchObject({ kind: 'voucher', sold: true });
    expect(bought.state.vouchers).toEqual(['extra_hand']);
    expect(bought.events.map((e) => e.type)).toEqual(['bought', 'voucherBought']);
    expect(bought.events[1]).toEqual({ type: 'voucherBought', voucherId: 'extra_hand' });
  });

  it('extra_hand and extra_discard count from the next blind, not the current one', () => {
    for (const [id, key, left] of [
      ['extra_hand', 'hands', 'handsLeft'],
      ['extra_discard', 'discards', 'discardsLeft'],
    ] as const) {
      const { state, content } = shopWith(id);
      const bought = buyVoucher(state, content).state;
      expect(bought.config[key]).toBe(DEFAULT_RUN_CONFIG[key] + 1);
      expect(bought[left]).toBe(state[left]);
      const next = act(bought, { type: 'leaveShop' }, content).state;
      expect(next[left]).toBe(DEFAULT_RUN_CONFIG[key] + 1);
    }
  });

  it('joker_slot and consumable_slot make room for one more', () => {
    const jokers = shopWith('joker_slot', { jokerSlots: 1 });
    const full = act(jokers.state, { type: 'buy', offerIndex: 0 }, jokers.content).state;
    expect(errorOf(full, { type: 'buy', offerIndex: 1 })).toBe('NO_JOKER_SLOT');
    const roomy = buyVoucher(full, jokers.content).state;
    expect(roomy.config.jokerSlots).toBe(2);
    expect(act(roomy, { type: 'buy', offerIndex: 1 }, jokers.content).state.jokers).toHaveLength(2);

    const items = shopWith('consumable_slot', { consumableSlots: 1 });
    const filled = act(items.state, { type: 'buy', offerIndex: 2 }, items.content).state;
    expect(errorOf(filled, { type: 'buy', offerIndex: 3 })).toBe('NO_CONSUMABLE_SLOT');
    const wider = buyVoucher(filled, items.content).state;
    expect(wider.config.consumableSlots).toBe(2);
    expect(
      act(wider, { type: 'buy', offerIndex: 3 }, items.content).state.consumables,
    ).toHaveLength(2);
  });

  it('interest_cap raises the interest paid when a blind is beaten', () => {
    const interestAfterNextWin = (id: string | null) => {
      const { state, content } = shopWith(id ?? 'extra_hand');
      const ready = id ? buyVoucher(state, content).state : state;
      const playing = act(ready, { type: 'leaveShop' }, content).state;
      const won = playFirst(playing, 1, content);
      const paid = won.events.find((e) => e.type === 'roundWon');
      return paid?.type === 'roundWon' ? paid.interest : -1;
    };
    expect(interestAfterNextWin(null)).toBe(DEFAULT_RUN_CONFIG.interestCap);
    expect(interestAfterNextWin('interest_cap')).toBe(DEFAULT_RUN_CONFIG.interestCap + 1);
  });

  it('cheap_reroll lowers the base and the current reroll cost, never below 0', () => {
    const { state, content } = shopWith('cheap_reroll');
    const cheaper = buyVoucher(state, content).state;
    expect([cheaper.config.rerollBaseCost, cheaper.rerollCost]).toEqual([2, state.rerollCost - 1]);

    const free = shopWith('cheap_reroll', {}, [{ key: 'rerollBaseCost', delta: -99 }]);
    const zero = buyVoucher(free.state, free.content).state;
    expect([zero.config.rerollBaseCost, zero.rerollCost]).toEqual([0, 0]);
  });

  it('does not mutate the previous config and rejects poor or repeated purchases', () => {
    const { state, content } = shopWith('extra_hand');
    const bought = buyVoucher(state, content).state;
    expect(state.config.hands).toBe(DEFAULT_RUN_CONFIG.hands);
    expect(bought.config).not.toBe(state.config);
    expect(errorOf({ ...state, money: 9 }, { type: 'buy', offerIndex: VOUCHER_INDEX })).toBe(
      'NOT_ENOUGH_MONEY',
    );
    const result = runReducer(bought, { type: 'buy', offerIndex: VOUCHER_INDEX }, content);
    expect(result.ok ? 'ok' : result.error.code).toBe('INVALID_OFFER');
  });

  it('is reproduced by replayRun', () => {
    const content = only('extra_hand');
    const config = { ...EASY, startingMoney: 50 };
    const first = createRun('vouchers', config, content).state.hand[0]!.id;
    const actions: RunAction[] = [
      { type: 'play', cardIds: [first] },
      { type: 'buy', offerIndex: VOUCHER_INDEX },
      { type: 'leaveShop' },
    ];
    const replayed = replayRun({ seed: 'vouchers', config, actions }, content).state;
    expect(replayed.config.hands).toBe(DEFAULT_RUN_CONFIG.hands + 1);
    expect(replayed.vouchers).toEqual(['extra_hand']);
    expect(replayed.handsLeft).toBe(DEFAULT_RUN_CONFIG.hands + 1);
  });

  it('never offers a bought voucher again', () => {
    const { state, content } = shopWith('extra_hand');
    const bought = buyVoucher(state, content).state;
    const next = playFirst(act(bought, { type: 'leaveShop' }, content).state, 1, content).state;
    expect(next.phase).toBe('shop');
    expect(next.shop.some((o) => o.kind === 'voucher')).toBe(false);
  });
});

describe('packs', () => {
  const PACK_INDEX = 4;
  const withPack = (id: string, extra: Partial<RunContent> = {}): RunContent => ({
    ...DEFAULT_CONTENT,
    packs: DEFAULT_CONTENT.packs.filter((p) => p.id === id),
    ...extra,
  });
  const shopWith = (content: RunContent, config: Partial<RunConfig> = {}) =>
    playFirst(
      createRun('packs', { ...EASY, startingMoney: 50, ...config }, content).state,
      1,
      content,
    ).state;
  const openPack = (id: string, config: Partial<RunConfig> = {}) => {
    const content = withPack(id);
    const state = shopWith(content, config);
    return { content, state, opened: act(state, { type: 'buy', offerIndex: PACK_INDEX }, content) };
  };
  const pick = (itemIndex: number): RunAction => ({ type: 'pickFromPack', itemIndex });
  const codeOf = (state: RunState, action: RunAction, content: RunContent) => {
    const result = runReducer(state, action, content);
    return result.ok ? 'ok' : result.error.code;
  };

  it('opens each kind of pack with `size` distinct options, charging the price', () => {
    for (const def of DEFAULT_CONTENT.packs) {
      const { state, opened } = openPack(def.id);
      expect(opened.state.money).toBe(state.money - def.cost);
      expect(opened.state.shop[PACK_INDEX]).toMatchObject({ kind: 'pack', sold: true });
      expect(opened.events.map((e) => e.type)).toEqual(['bought', 'packOpened']);
      const open = opened.state.openPack!;
      expect([open.packId, open.picksLeft, open.items.length]).toEqual([
        def.id,
        def.picks,
        def.size,
      ]);
      expect(open.items.every((i) => !i.taken && i.kind === def.kind)).toBe(true);
      const keys = open.items.map((i) =>
        i.kind === 'joker'
          ? i.jokerId
          : i.kind === 'consumable'
            ? i.consumableId
            : `${i.rank}${i.suit}`,
      );
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('card packs only offer enhanced cards from the content', () => {
    const { opened } = openPack('pack_card');
    const known = DEFAULT_CONTENT.enhancements.map((e) => e.id);
    for (const item of opened.state.openPack!.items) {
      expect(item.kind === 'card' && known.includes(item.enhancement)).toBe(true);
    }
  });

  it('joker packs never offer a joker already owned', () => {
    const content = withPack('pack_joker');
    const state = shopWith(content);
    const owned = act(state, { type: 'buy', offerIndex: 0 }, content).state;
    const items = act(owned, { type: 'buy', offerIndex: PACK_INDEX }, content).state.openPack!
      .items;
    const ownedId = owned.jokers[0]!.jokerId;
    expect(items.some((i) => i.kind === 'joker' && i.jokerId === ownedId)).toBe(false);
  });

  it('is deterministic and draws only from the pack stream', () => {
    const first = openPack('pack_joker');
    const second = openPack('pack_joker');
    expect(first.opened.state.openPack).toEqual(second.opened.state.openPack);
    expect(first.opened.state.rng.shop).toEqual(first.state.rng.shop);
    expect(first.opened.state.rng.pack).not.toEqual(first.state.rng.pack);
  });

  it('picking a joker, a consumable or a card puts it where it belongs and closes the pack', () => {
    const joker = openPack('pack_joker');
    const afterJoker = act(joker.opened.state, pick(0), joker.content);
    const item = joker.opened.state.openPack!.items[0]!;
    const def = DEFAULT_CONTENT.jokers.find((j) => item.kind === 'joker' && j.id === item.jokerId)!;
    expect(afterJoker.state.jokers).toEqual([
      { instanceId: 'j1', jokerId: def.id, state: { ...def.initialState } },
    ]);
    expect(afterJoker.state.openPack).toBeNull();
    expect(afterJoker.events).toEqual([{ type: 'packPicked', itemIndex: 0 }]);

    const consumable = openPack('pack_consumable');
    const picked = consumable.opened.state.openPack!.items[1]!;
    const afterConsumable = act(consumable.opened.state, pick(1), consumable.content).state;
    expect(afterConsumable.consumables).toEqual([
      { instanceId: 'c1', consumableId: picked.kind === 'consumable' ? picked.consumableId : '' },
    ]);

    const card = openPack('pack_card');
    const chosen = card.opened.state.openPack!.items[2]!;
    const afterCard = act(card.opened.state, pick(2), card.content).state;
    expect(afterCard.deck).toHaveLength(53);
    expect(afterCard.deck[52]).toEqual({
      id: 'x1',
      ...(chosen.kind === 'card'
        ? { suit: chosen.suit, rank: chosen.rank, enhancement: chosen.enhancement }
        : {}),
    });
    expect(hasUniqueIds(afterCard.deck)).toBe(true);
    expect(afterCard.nextCardNumber).toBe(2);
  });

  it('takes several picks, marks taken items and refuses the same item twice', () => {
    const content = withPack('pack_consumable');
    const two: RunContent = { ...content, packs: [{ ...content.packs[0]!, picks: 2 }] };
    const opened = act(shopWith(two), { type: 'buy', offerIndex: PACK_INDEX }, two).state;
    const once = act(opened, pick(0), two).state;
    expect(once.openPack!.picksLeft).toBe(1);
    expect(once.openPack!.items.map((i) => i.taken)).toEqual([true, false, false]);
    expect(codeOf(once, pick(0), two)).toBe('INVALID_PACK_ITEM');
    const twice = act(once, pick(2), two).state;
    expect(twice.openPack).toBeNull();
    expect(twice.consumables).toHaveLength(2);
  });

  it('skipping closes the pack, also after a partial pick', () => {
    const { opened, content } = openPack('pack_joker');
    const skipped = act(opened.state, { type: 'skipPack' }, content);
    expect(skipped.state.openPack).toBeNull();
    expect(skipped.events).toEqual([{ type: 'packSkipped' }]);
    expect(skipped.state.jokers).toEqual([]);

    const two: RunContent = { ...content, packs: [{ ...content.packs[0]!, picks: 2 }] };
    const reopened = act(shopWith(two), { type: 'buy', offerIndex: PACK_INDEX }, two).state;
    const partly = act(reopened, pick(0), two).state;
    expect(act(partly, { type: 'skipPack' }, two).state.openPack).toBeNull();
  });

  it('refuses to open a pack with no free slot, without charging', () => {
    const jokers = withPack('pack_joker');
    const full = act(
      shopWith(jokers, { jokerSlots: 1 }),
      { type: 'buy', offerIndex: 0 },
      jokers,
    ).state;
    expect(codeOf(full, { type: 'buy', offerIndex: PACK_INDEX }, jokers)).toBe('NO_JOKER_SLOT');

    const items = withPack('pack_consumable');
    const stocked = act(
      shopWith(items, { consumableSlots: 1 }),
      { type: 'buy', offerIndex: 2 },
      items,
    ).state;
    expect(codeOf(stocked, { type: 'buy', offerIndex: PACK_INDEX }, items)).toBe(
      'NO_CONSUMABLE_SLOT',
    );
  });

  it('fails a pick with no free slot, keeping the pack open and the state unchanged', () => {
    const { opened, content } = openPack('pack_joker', { jokerSlots: 1 });
    const crowded: RunState = {
      ...opened.state,
      jokers: [{ instanceId: 'j9', jokerId: 'tip_jar', state: {} }],
    };
    expect(codeOf(crowded, pick(0), content)).toBe('NO_JOKER_SLOT');

    const { opened: itemPack, content: itemContent } = openPack('pack_consumable', {
      consumableSlots: 1,
    });
    const stocked: RunState = {
      ...itemPack.state,
      consumables: [{ instanceId: 'c9', consumableId: 'study_pair' }],
    };
    expect(codeOf(stocked, pick(0), itemContent)).toBe('NO_CONSUMABLE_SLOT');
    // The reducer never mutates: the open pack is still all untaken.
    expect(stocked.openPack!.items.every((i) => !i.taken)).toBe(true);
  });

  it('locks the shop while a pack is open', () => {
    const { opened, content } = openPack('pack_joker');
    const locked: RunAction[] = [
      { type: 'buy', offerIndex: 0 },
      { type: 'reroll' },
      { type: 'leaveShop' },
      { type: 'sellJoker', instanceId: 'j1' },
      { type: 'applyConsumable', instanceId: 'c1' },
      { type: 'sellConsumable', instanceId: 'c1' },
      { type: 'moveJoker', from: 0, to: 1 },
    ];
    for (const action of locked) expect(codeOf(opened.state, action, content)).toBe('PACK_OPEN');
    expect(act(opened.state, { type: 'abandon' }, content).state.status).toBe('abandoned');
  });

  it('rejects picks and skips without an open pack and picks out of range', () => {
    const { state, opened, content } = openPack('pack_joker');
    expect(codeOf(state, pick(0), content)).toBe('NO_PACK_OPEN');
    expect(codeOf(state, { type: 'skipPack' }, content)).toBe('NO_PACK_OPEN');
    expect(codeOf(opened.state, pick(-1), content)).toBe('INVALID_PACK_ITEM');
    expect(codeOf(opened.state, pick(99), content)).toBe('INVALID_PACK_ITEM');
  });

  it('offers what the catalog has and refuses a pack with nothing to offer', () => {
    const two: RunContent = {
      ...withPack('pack_joker'),
      jokers: DEFAULT_CONTENT.jokers.slice(0, 2),
    };
    const state = shopWith(two);
    expect(
      act(state, { type: 'buy', offerIndex: PACK_INDEX }, two).state.openPack!.items,
    ).toHaveLength(2);

    const one: RunContent = {
      ...withPack('pack_joker'),
      jokers: DEFAULT_CONTENT.jokers.slice(0, 1),
    };
    const owned: RunState = {
      ...shopWith(one),
      jokers: [{ instanceId: 'j1', jokerId: one.jokers[0]!.id, state: {} }],
    };
    // With one joker in the catalog the shop has only one joker offer, so the pack moves up.
    const packIndex = owned.shop.findIndex((o) => o.kind === 'pack');
    expect(codeOf(owned, { type: 'buy', offerIndex: packIndex }, one)).toBe('INVALID_OFFER');
  });

  it('survives a save and load with the pack open', () => {
    const { opened, content } = openPack('pack_card');
    const loaded = JSON.parse(JSON.stringify(opened.state)) as RunState;
    expect(loaded.openPack).toEqual(opened.state.openPack);
    expect(act(loaded, pick(0), content).state.deck).toHaveLength(53);
  });

  it('is reproduced by replayRun', () => {
    const content = withPack('pack_card');
    const config = { ...EASY, startingMoney: 50 };
    const first = createRun('packs', config, content).state.hand[0]!.id;
    const actions: RunAction[] = [
      { type: 'play', cardIds: [first] },
      { type: 'buy', offerIndex: PACK_INDEX },
      pick(1),
      { type: 'leaveShop' },
    ];
    const once = replayRun({ seed: 'packs', config, actions }, content).state;
    const again = replayRun({ seed: 'packs', config, actions }, content).state;
    expect(once).toEqual(again);
    expect(once.deck).toHaveLength(53);
  });
});
