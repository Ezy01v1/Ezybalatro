import {
  createStandardDeck,
  createTable,
  holdemReducer,
  nextHandPositions,
  parseCards,
  type Card,
  type HoldemAction,
  type HoldemEvent,
  type TableConfig,
  type TableState,
} from '../index';

export const BLINDS_1_2: TableConfig = {
  maxSeats: 6,
  smallBlind: 1,
  bigBlind: 2,
  minBuyIn: 1,
  maxBuyIn: 1_000_000,
};

/** Table with players "p0".."pN" sitting in seats 0..N with the given stacks. */
export function tableWith(stacks: readonly number[], config: TableConfig = BLINDS_1_2): TableState {
  let state = createTable(config);
  stacks.forEach((stack, seat) => {
    state = run(state, { type: 'sit', playerId: `p${seat}`, seat, buyIn: stack }).state;
  });
  return state;
}

/** Applies actions in order and fails the test on the first rejected one. */
export function run(
  state: TableState,
  ...actions: HoldemAction[]
): { state: TableState; events: HoldemEvent[] } {
  const events: HoldemEvent[] = [];
  for (const action of actions) {
    const result = holdemReducer(state, action);
    if (!result.ok)
      throw new Error(`${action.type} rejected: ${result.error.code} ${result.error.message}`);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

/**
 * Deck that deals `holes` (by seat) and `board` ("Ah Kd 7c 2s 9h") for the next hand of `state`;
 * burn cards and the rest are filled with unused cards.
 */
export function stackedDeck(state: TableState, holes: Record<number, string>, board = ''): Card[] {
  const positions = nextHandPositions(state);
  if (!positions) throw new Error('Not enough players for a hand');
  const holeCards = new Map(
    Object.entries(holes).map(([seat, text]) => [Number(seat), parseCards(text)]),
  );
  const boardCards = parseCards(board);
  const used = new Set(
    [...holeCards.values()]
      .flat()
      .concat(boardCards)
      .map((c) => c.id),
  );
  const spare = createStandardDeck().filter((c) => !used.has(c.id));
  const take = (card: Card | undefined) => card ?? spare.shift()!;

  const deck: Card[] = [];
  for (let round = 0; round < 2; round++) {
    for (const seat of positions.dealOrder) deck.push(take(holeCards.get(seat)?.[round]));
  }
  const b = [...boardCards];
  for (const count of [3, 1, 1]) {
    deck.push(spare.shift()!); // burn
    for (let i = 0; i < count; i++) deck.push(take(b.shift()));
  }
  return [...deck, ...spare];
}

export function totalChips(state: TableState): number {
  const stacks = state.seats.reduce((sum, s) => sum + (s?.stack ?? 0), 0);
  const committed =
    state.hand && state.hand.street !== 'settled' && state.hand.street !== 'voided'
      ? state.hand.players.reduce((sum, p) => sum + p.totalBet, 0)
      : 0;
  return stacks + committed;
}

export function stacksOf(state: TableState): (number | null)[] {
  return state.seats.map((s) => s?.stack ?? null);
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
