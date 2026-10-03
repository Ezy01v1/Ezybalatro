import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bestHand,
  compareHands,
  createSeededRng,
  createStandardDeck,
  hasUniqueIds,
  holdemReducer,
  isHandInProgress,
  legalActions,
  nextHandPositions,
  nextInt,
  shuffleDeck,
  viewFor,
  type Card,
  type HoldemAction,
  type HoldemEvent,
  type Rng,
  type TableState,
} from '../index';
import { deepFreeze, tableWith, totalChips } from '../testing/holdem-fixtures';

const randInt = (rng: Rng, min: number, max: number) => min + nextInt(rng, max - min + 1);
const chance = (rng: Rng, percent: number) => nextInt(rng, 100) < percent;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[nextInt(rng, items.length)]!;

function isCard(value: unknown): value is Card {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'rank' in value &&
    'suit' in value
  );
}

/** Every card object reachable from `value`. */
function cardsIn(value: unknown, found: Card[] = []): Card[] {
  if (isCard(value)) found.push(value);
  else if (Array.isArray(value)) value.forEach((v) => cardsIn(v, found));
  else if (typeof value === 'object' && value !== null)
    Object.values(value).forEach((v) => cardsIn(v, found));
  return found;
}

/** A random action that is legal for the player to act (bets and raises of random size). */
function randomLegalAction(rng: Rng, state: TableState): HoldemAction {
  const hand = state.hand!;
  const playerId = hand.players.find((p) => p.seat === hand.toAct)!.playerId;
  const legal = legalActions(state, playerId)!;
  const options: HoldemAction[] = [];
  if (legal.canCheck) options.push({ type: 'check', playerId }, { type: 'check', playerId });
  else options.push({ type: 'fold', playerId });
  if (legal.callAmount > 0) options.push({ type: 'call', playerId }, { type: 'call', playerId });
  if (legal.bet)
    options.push({ type: 'bet', playerId, amount: randInt(rng, legal.bet.min, legal.bet.max) });
  if (legal.raise)
    options.push({ type: 'raise', playerId, to: randInt(rng, legal.raise.min, legal.raise.max) });
  if (legal.allIn !== null) options.push({ type: 'allIn', playerId });
  return pick(rng, options);
}

/** Anything, legal or not: wrong player, wrong amounts, actions out of phase. */
function randomChaosAction(rng: Rng, state: TableState): HoldemAction {
  const playerId = pick(rng, [...state.seats.flatMap((s) => (s ? [s.playerId] : [])), 'ghost']);
  const amount = randInt(rng, -5, 500);
  return pick<HoldemAction>(rng, [
    { type: 'fold', playerId },
    { type: 'check', playerId },
    { type: 'call', playerId },
    { type: 'bet', playerId, amount },
    { type: 'raise', playerId, to: amount },
    { type: 'allIn', playerId },
    { type: 'timeout', playerId },
    { type: 'leave', playerId },
    { type: 'sitOut', playerId },
    { type: 'sitIn', playerId },
    { type: 'sit', playerId: `new-${amount}`, seat: randInt(rng, 0, 6), buyIn: amount },
    { type: 'postBlinds', deck: createStandardDeck() },
  ]);
}

interface Tracker {
  /** Chips that should be at the table: buy-ins minus cash-outs. */
  expectedChips: number;
  handsPlayed: number;
  showdowns: number;
  sidePots: number;
}

function checkInvariants(next: TableState, events: readonly HoldemEvent[], tracker: Tracker): void {
  for (const e of events) {
    if (e.type === 'playerSat') tracker.expectedChips += e.stack;
    if (e.type === 'playerLeft') tracker.expectedChips -= e.cashOut;
  }

  // Invariant 1: chip conservation (stacks + pot), integer and non-negative.
  expect(totalChips(next)).toBe(tracker.expectedChips);
  for (const s of next.seats)
    if (s) expect(Number.isSafeInteger(s.stack) && s.stack >= 0).toBe(true);

  const hand = next.hand;
  if (!hand) return;

  // Invariant 2: every card exists once.
  const allCards = [...hand.players.flatMap((p) => p.holeCards), ...hand.board, ...hand.deck];
  expect(hasUniqueIds(allCards)).toBe(true);
  expect(allCards.length).toBeLessThanOrEqual(52);

  // Invariant 4: views and broadcast events never leak private cards.
  const shownSeats = new Set(hand.showdown.map((h) => h.seat));
  const viewers = [
    ...next.seats.flatMap((s) => (s ? [s.playerId] : [])),
    hand.players[0]!.playerId,
    'spectator',
  ];
  for (const viewer of viewers) {
    const allowed = new Set([
      ...hand.board.map((c) => c.id),
      ...hand.players
        .filter((p) => p.playerId === viewer || shownSeats.has(p.seat))
        .flatMap((p) => p.holeCards.map((c) => c.id)),
    ]);
    for (const card of cardsIn(viewFor(next, viewer))) {
      if (!allowed.has(card.id)) throw new Error(`viewFor(${viewer}) leaked ${card.id}`);
    }
  }
  const holeIds = new Set(hand.players.flatMap((p) => p.holeCards.map((c) => c.id)));
  for (const e of events) {
    if (e.type === 'showdown') continue;
    for (const card of cardsIn(e))
      if (holeIds.has(card.id)) throw new Error(`event ${e.type} leaked ${card.id}`);
  }

  if (events.some((e) => e.type === 'handSettled')) {
    tracker.handsPlayed++;
    const pot = hand.players.reduce((sum, p) => sum + p.totalBet, 0);
    expect(hand.awards.reduce((sum, a) => sum + a.amount, 0)).toBe(pot);
    for (const award of hand.awards)
      expect(award.winners.reduce((sum, w) => sum + w.amount, 0)).toBe(award.amount);
    if (hand.showdown.length > 0) tracker.showdowns++;
    if (hand.awards.filter((a) => a.eligibleSeats.length > 1).length > 1) tracker.sidePots++;

    // The reducer's winners are exactly the best hands by compareHands among each pot's eligible players.
    for (const award of hand.awards.filter((a) => a.eligibleSeats.length > 1)) {
      const evaluated = award.eligibleSeats.map((seat) => {
        const p = hand.players.find((x) => x.seat === seat)!;
        return { seat, hand: bestHand([...p.holeCards, ...hand.board]) };
      });
      const top = evaluated.reduce((a, b) => (compareHands(a.hand, b.hand) >= 0 ? a : b));
      const expectedWinners = evaluated
        .filter((e) => compareHands(e.hand, top.hand) === 0)
        .map((e) => e.seat);
      expect(award.winners.map((w) => w.seat).sort()).toEqual(expectedWinners.sort());
    }
  }
}

/** Plays `maxHands` hands with random legal actions plus random seat changes and illegal actions. */
function simulate(
  seed: string,
  stacks: readonly number[],
  maxHands: number,
  tracker: Tracker,
): void {
  const rng = createSeededRng(seed, 'sim');
  let state = deepFreeze(tableWith(stacks));
  tracker.expectedChips = stacks.reduce((a, b) => a + b, 0);
  let nextPlayer = stacks.length;

  const step = (action: HoldemAction) => {
    const result = holdemReducer(state, action);
    if (!result.ok) return;
    try {
      checkInvariants(result.state, result.events, tracker);
    } catch (error) {
      const context = {
        action: { ...action, deck: undefined },
        before: { ...state.hand, deck: undefined },
        events: result.events,
      };
      throw new Error(`${(error as Error).message}\n${JSON.stringify(context)}`, { cause: error });
    }
    state = deepFreeze(result.state);
  };

  for (let h = 0; h < maxHands; h++) {
    // Between hands: people come and go.
    for (const [seat, s] of state.seats.entries()) {
      if (!s) {
        if (chance(rng, 15))
          step({ type: 'sit', playerId: `p${nextPlayer++}`, seat, buyIn: randInt(rng, 1, 300) });
      } else if (s.stack === 0 || chance(rng, 5)) {
        step({ type: 'leave', playerId: s.playerId });
      } else if (s.status === 'sitting_out' && chance(rng, 50)) {
        step({ type: 'sitIn', playerId: s.playerId });
      }
    }
    if (!nextHandPositions(state)) continue;
    step({ type: 'postBlinds', deck: shuffleDeck(rng, createStandardDeck()) });

    let guard = 0;
    while (isHandInProgress(state.hand)) {
      if (++guard > 500) throw new Error('Hand did not finish');
      const hand = state.hand;
      const actor = hand.players.find((p) => p.seat === hand.toAct)!;
      const roll = nextInt(rng, 100);
      if (roll < 4) step(randomChaosAction(rng, state));
      else if (roll < 6) step({ type: 'leave', playerId: pick(rng, hand.players).playerId });
      else if (roll < 8) step({ type: 'timeout', playerId: actor.playerId });
      else if (roll < 9) step({ type: 'voidHand' });
      else step(randomLegalAction(rng, state));
    }
  }
}

describe("Hold'em properties (random legal play)", () => {
  const totals: Tracker = { expectedChips: 0, handsPlayed: 0, showdowns: 0, sidePots: 0 };

  afterAll(() => {
    // Make sure the simulation exercised the interesting paths, not just folds.
    expect(totals.handsPlayed).toBeGreaterThan(3000);
    expect(totals.showdowns).toBeGreaterThan(300);
    expect(totals.sidePots).toBeGreaterThan(50);
    console.info(
      `Hold'em simulation: ${totals.handsPlayed} hands, ${totals.showdowns} showdowns, ${totals.sidePots} with side pots`,
    );
  });

  it('conserves chips, never leaks private cards, and settles pots like compareHands', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.array(fc.oneof(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 13, max: 400 })), {
          minLength: 2,
          maxLength: 6,
        }),
        (seed, stacks) => {
          const tracker: Tracker = { expectedChips: 0, handsPlayed: 0, showdowns: 0, sidePots: 0 };
          simulate(seed, stacks, 25, tracker);
          totals.handsPlayed += tracker.handsPlayed;
          totals.showdowns += tracker.showdowns;
          totals.sidePots += tracker.sidePots;
        },
      ),
      { numRuns: 200, examples: [['', [2, 3, 13, 13]]] },
    );
  }, 120_000);

  it('rejected actions never change the state', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const rng = createSeededRng(seed, 'chaos');
        let state = deepFreeze(tableWith([50, 80, 120]));
        state = deepFreeze(
          (
            holdemReducer(state, {
              type: 'postBlinds',
              deck: shuffleDeck(rng, createStandardDeck()),
            }) as { state: TableState }
          ).state,
        );
        for (let i = 0; i < 30 && isHandInProgress(state.hand); i++) {
          const snapshot = JSON.stringify(state);
          const result = holdemReducer(state, randomChaosAction(rng, state));
          expect(JSON.stringify(state)).toBe(snapshot);
          if (result.ok) state = deepFreeze(result.state);
        }
      }),
    );
  });
});
