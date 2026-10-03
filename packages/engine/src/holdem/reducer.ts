import { isCompleteStandardDeck, type Card } from '../cards';
import { bestHand, compareHands } from '../hands/poker-hand';
import { buildPots, splitPot } from './pots';
import {
  findSeatFrom,
  isHandInProgress,
  legalActions,
  needsToAct,
  nextHandPositions,
} from './rules';
import type {
  BettingAction,
  HandPlayer,
  HandState,
  HoldemAction,
  HoldemErrorCode,
  HoldemEvent,
  HoldemResult,
  PotAward,
  SeatState,
  ShowdownHand,
  TableConfig,
  TableState,
} from './types';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type DraftPlayer = Mutable<HandPlayer>;
type DraftSeat = Mutable<SeatState>;
interface DraftHand extends Omit<Mutable<HandState>, 'players' | 'deck' | 'board'> {
  players: DraftPlayer[];
  deck: Card[];
  board: Card[];
}
interface Draft {
  config: TableConfig;
  seats: (DraftSeat | null)[];
  buttonSeat: number | null;
  smallBlindPosition: number | null;
  bigBlindSeat: number | null;
  handNumber: number;
  hand: DraftHand | null;
  events: HoldemEvent[];
}

export function createTable(config: TableConfig): TableState {
  const { maxSeats, smallBlind, bigBlind, minBuyIn, maxBuyIn } = config;
  const positiveInts = [maxSeats, smallBlind, bigBlind, minBuyIn, maxBuyIn].every(
    (n) => Number.isSafeInteger(n) && n > 0,
  );
  if (
    !positiveInts ||
    maxSeats < 2 ||
    maxSeats > 6 ||
    smallBlind > bigBlind ||
    minBuyIn > maxBuyIn
  ) {
    throw new RangeError('Invalid table config');
  }
  return {
    config,
    seats: new Array<null>(maxSeats).fill(null),
    buttonSeat: null,
    smallBlindPosition: null,
    bigBlindSeat: null,
    handNumber: 0,
    hand: null,
  };
}

/** Pure Hold'em No-Limit reducer: never mutates `state`; invalid actions return an error and no state. */
export function holdemReducer(state: TableState, action: HoldemAction): HoldemResult {
  switch (action.type) {
    case 'sit':
      return sit(state, action.playerId, action.seat, action.buyIn, action.postBlindsToEnter);
    case 'leave':
      return leave(state, action.playerId);
    case 'sitOut':
      return sitOut(state, action.playerId);
    case 'sitIn':
      return sitIn(state, action.playerId, action.postBlindsToEnter);
    case 'postBlinds':
      return startHand(state, action.deck);
    case 'voidHand':
      return voidHand(state);
    case 'fold':
    case 'check':
    case 'call':
    case 'allIn':
    case 'timeout':
      return bettingAction(state, action.playerId, action.type, 0);
    case 'bet':
      return bettingAction(state, action.playerId, 'bet', action.amount);
    case 'raise':
      return bettingAction(state, action.playerId, 'raise', action.to);
  }
}

// ---------------------------------------------------------------- seats

function sit(
  state: TableState,
  playerId: string,
  seat: number,
  buyIn: number,
  postBlindsToEnter = false,
): HoldemResult {
  const { maxSeats, minBuyIn, maxBuyIn } = state.config;
  if (!Number.isInteger(seat) || seat < 0 || seat >= maxSeats)
    return fail('INVALID_SEAT', `Seat must be 0..${maxSeats - 1}`);
  if (state.seats[seat]) return fail('SEAT_TAKEN', `Seat ${seat} is taken`);
  if (seatOf(state, playerId) !== -1)
    return fail('ALREADY_SEATED', 'Player is already seated at this table');
  if (!Number.isSafeInteger(buyIn) || buyIn < minBuyIn || buyIn > maxBuyIn) {
    return fail('INVALID_BUY_IN', `Buy-in must be an integer in [${minBuyIn}, ${maxBuyIn}]`);
  }
  const d = toDraft(state);
  // Once the table has dealt, a new player owes the big blind (so changing seats never skips it).
  d.seats[seat] = {
    playerId,
    stack: buyIn,
    status: 'seated',
    owesBigBlind: state.handNumber > 0,
    owesSmallBlind: false,
    postBlindsToEnter,
  };
  d.events.push({ type: 'playerSat', seat, playerId, stack: buyIn });
  return done(d);
}

function leave(state: TableState, playerId: string): HoldemResult {
  const seat = seatOf(state, playerId);
  if (seat === -1) return fail('NOT_SEATED', 'Player is not seated');
  const hand = state.hand;
  const inHand = isHandInProgress(hand) ? hand.players.find((p) => p.seat === seat) : undefined;

  if (!inHand) {
    const d = toDraft(state);
    removeSeat(d, seat);
    return done(d);
  }
  if (!inHand.folded && !inHand.allIn && hand?.toAct === seat) {
    // Their turn: fold now, then the seat is freed when the hand settles.
    const result = bettingAction(state, playerId, 'fold', 0, 'leave');
    if (!result.ok) return result;
    const d = toDraft(result.state, result.events);
    markLeaving(d, seat);
    return done(d);
  }
  const d = toDraft(state);
  const player = d.hand!.players.find((p) => p.seat === seat)!;
  markLeaving(d, seat);
  if (!player.folded && !player.allIn) {
    // Folding out of turn does not change who acts next.
    player.folded = true;
    player.hasActed = true;
    d.events.push({
      type: 'playerActed',
      seat,
      action: 'fold',
      amount: 0,
      to: player.streetBet,
      allIn: false,
      auto: 'leave',
    });
    proceed(d, d.hand!.toAct ?? seat);
  }
  // An all-in player stays in the hand until it settles.
  return done(d);
}

function sitOut(state: TableState, playerId: string): HoldemResult {
  const seat = seatOf(state, playerId);
  if (seat === -1) return fail('NOT_SEATED', 'Player is not seated');
  if (state.seats[seat]?.status !== 'seated')
    return fail('INVALID_ACTION', 'Player is not in seated status');
  const d = toDraft(state);
  d.seats[seat]!.status = 'sitting_out';
  d.events.push({ type: 'playerSatOut', seat, playerId });
  return done(d);
}

function sitIn(state: TableState, playerId: string, postBlindsToEnter?: boolean): HoldemResult {
  const seat = seatOf(state, playerId);
  if (seat === -1) return fail('NOT_SEATED', 'Player is not seated');
  const current = state.seats[seat]!;
  if (current.status !== 'sitting_out') return fail('INVALID_ACTION', 'Player is not sitting out');
  if (current.stack === 0) return fail('INVALID_ACTION', 'Cannot sit in with an empty stack');
  const d = toDraft(state);
  d.seats[seat]!.status = 'seated';
  if (postBlindsToEnter !== undefined) d.seats[seat]!.postBlindsToEnter = postBlindsToEnter;
  d.events.push({ type: 'playerSatIn', seat, playerId });
  return done(d);
}

// ---------------------------------------------------------------- hand lifecycle

function startHand(state: TableState, deck: readonly Card[]): HoldemResult {
  if (isHandInProgress(state.hand))
    return fail('HAND_IN_PROGRESS', 'A hand is already in progress');
  if (!isCompleteStandardDeck(deck))
    return fail('INVALID_DECK', 'Deck must be the 52 standard cards');
  const positions = nextHandPositions(state);
  if (!positions) return fail('NOT_ENOUGH_PLAYERS', 'At least 2 players with chips are needed');
  const { smallBlind, bigBlind } = state.config;
  const { buttonSeat, smallBlindSeat, bigBlindSeat, dealOrder } = positions;
  const dealtIn = [...dealOrder].sort((a, b) => a - b);

  const d = toDraft(state);
  for (const { seat, blind } of positions.missedBlinds) {
    const missedBy = d.seats[seat]!;
    if (blind === 'big') missedBy.owesBigBlind = true;
    else missedBy.owesSmallBlind = true;
    d.events.push({ type: 'blindMissed', seat, blind });
  }
  const remaining = [...deck];
  const hole = new Map<number, Card[]>(dealtIn.map((seat) => [seat, []]));
  for (let round = 0; round < 2; round++)
    for (const seat of dealOrder) hole.get(seat)!.push(remaining.shift()!);

  d.handNumber += 1;
  d.buttonSeat = buttonSeat;
  d.smallBlindPosition = positions.smallBlindPosition;
  d.bigBlindSeat = bigBlindSeat;
  const hand: DraftHand = {
    handNumber: d.handNumber,
    street: 'preflop',
    buttonSeat,
    smallBlindSeat,
    bigBlindSeat,
    deadMoney: 0,
    lastAggressorSeat: null,
    deck: remaining,
    board: [],
    players: dealtIn.map((seat) => ({
      seat,
      playerId: d.seats[seat]!.playerId,
      holeCards: hole.get(seat) as unknown as readonly [Card, Card],
      streetBet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      hasActed: false,
      actedAtBet: 0,
    })),
    currentBet: bigBlind,
    minRaise: bigBlind,
    toAct: null,
    startingStacks: dealtIn.map((seat) => ({ seat, stack: d.seats[seat]!.stack })),
    awards: [],
    showdown: [],
    mucked: [],
  };
  d.hand = hand;
  d.events.push({
    type: 'handStarted',
    handNumber: d.handNumber,
    buttonSeat,
    smallBlindSeat,
    bigBlindSeat,
    seats: dealtIn,
  });
  const post = (seat: number, blind: 'small' | 'big', size: number) => {
    const player = playerAt(d, seat);
    const amount = commit(d, player, size);
    d.events.push({ type: 'blindPosted', seat, blind, amount, allIn: player.allIn });
  };
  if (smallBlindSeat !== null) post(smallBlindSeat, 'small', smallBlind);
  post(bigBlindSeat, 'big', bigBlind);
  // Owed blinds posted to enter: the big blind is live (part of the bet), the small blind is dead.
  for (const entry of positions.entryPosts) {
    if (entry.bigBlind) post(entry.seat, 'big', bigBlind);
    if (entry.deadSmallBlind) {
      const seat = d.seats[entry.seat]!;
      const player = playerAt(d, entry.seat);
      const amount = Math.min(smallBlind, seat.stack);
      seat.stack -= amount;
      hand.deadMoney += amount;
      if (seat.stack === 0) player.allIn = true;
      d.events.push({
        type: 'blindPosted',
        seat: entry.seat,
        blind: 'dead_small',
        amount,
        allIn: player.allIn,
      });
    }
  }
  for (const seat of positions.clearedSeats) {
    d.seats[seat]!.owesBigBlind = false;
    d.seats[seat]!.owesSmallBlind = false;
  }
  proceed(d, bigBlindSeat + 1);
  return done(d);
}

function voidHand(state: TableState): HoldemResult {
  if (!isHandInProgress(state.hand)) return fail('NO_HAND_IN_PROGRESS', 'No hand in progress');
  const d = toDraft(state);
  const hand = d.hand!;
  for (const { seat, stack } of hand.startingStacks) d.seats[seat]!.stack = stack;
  hand.street = 'voided';
  hand.toAct = null;
  d.events.push({ type: 'handVoided', handNumber: hand.handNumber });
  freeLeavingSeats(d);
  return done(d);
}

// ---------------------------------------------------------------- betting

type BettingType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn' | 'timeout';

function bettingAction(
  state: TableState,
  playerId: string,
  type: BettingType,
  amountTo: number,
  auto?: 'leave',
): HoldemResult {
  if (!isHandInProgress(state.hand)) return fail('NO_HAND_IN_PROGRESS', 'No hand in progress');
  const legal = legalActions(state, playerId);
  if (!legal) return fail('NOT_YOUR_TURN', 'It is not this player’s turn');

  const d = toDraft(state);
  const hand = d.hand!;
  const player = playerAt(d, legal.seat);
  let action: BettingAction;
  let autoReason: 'timeout' | 'leave' | undefined = auto;
  let resolved: BettingType = type;

  if (type === 'timeout') {
    resolved = legal.canCheck ? 'check' : 'fold';
    autoReason = 'timeout';
    const seat = d.seats[legal.seat]!;
    if (seat.status === 'seated') {
      seat.status = 'sitting_out';
      d.events.push({ type: 'playerSatOut', seat: legal.seat, playerId });
    }
  }
  if (resolved === 'allIn') {
    if (legal.allIn === null) return fail('INVALID_ACTION', 'All-in is not allowed now');
    const to = player.streetBet + legal.allIn;
    resolved = to <= hand.currentBet ? 'call' : hand.currentBet === 0 ? 'bet' : 'raise';
    amountTo = to;
  }

  let added = 0;
  switch (resolved) {
    case 'fold':
      player.folded = true;
      action = 'fold';
      break;
    case 'check':
      if (!legal.canCheck) return fail('INVALID_ACTION', 'Cannot check facing a bet');
      action = 'check';
      break;
    case 'call':
      if (legal.callAmount === 0) return fail('INVALID_ACTION', 'Nothing to call');
      added = commit(d, player, legal.callAmount);
      action = 'call';
      break;
    case 'bet':
    case 'raise': {
      const range = resolved === 'bet' ? legal.bet : legal.raise;
      if (!range) return fail('INVALID_ACTION', `Cannot ${resolved} now`);
      if (!Number.isSafeInteger(amountTo) || amountTo < range.min || amountTo > range.max) {
        return fail(
          'INVALID_AMOUNT',
          `${resolved} must be to an integer in [${range.min}, ${range.max}]`,
        );
      }
      const increment = amountTo - hand.currentBet;
      hand.lastAggressorSeat = player.seat;
      // Only a full bet/raise sets a new minimum raise; an incomplete all-in leaves it unchanged.
      if (increment >= hand.minRaise) hand.minRaise = increment;
      hand.currentBet = amountTo;
      added = commit(d, player, amountTo - player.streetBet);
      action = resolved;
      break;
    }
    default:
      throw new Error(`Unhandled betting action ${resolved}`);
  }

  player.hasActed = true;
  player.actedAtBet = hand.currentBet;
  d.events.push({
    type: 'playerActed',
    seat: player.seat,
    action,
    amount: added,
    to: player.streetBet,
    allIn: player.allIn,
    ...(autoReason ? { auto: autoReason } : {}),
  });
  proceed(d, player.seat + 1);
  return done(d);
}

/** Moves chips from the seat to the pot; caps at the stack (all-in). Returns the chips moved. */
function commit(d: Draft, player: DraftPlayer, amount: number): number {
  const seat = d.seats[player.seat]!;
  const moved = Math.min(amount, seat.stack);
  seat.stack -= moved;
  player.streetBet += moved;
  player.totalBet += moved;
  if (seat.stack === 0) player.allIn = true;
  return moved;
}

/**
 * Advances the hand after any change: picks the next player to act (searching clockwise from
 * `searchFrom`, inclusive), or closes the round and deals the next street, runs out the board, or settles.
 */
function proceed(d: Draft, searchFrom: number): void {
  const hand = d.hand!;
  const live = hand.players.filter((p) => !p.folded);
  if (live.length === 1) return settle(d);

  const next = findSeatFrom(searchFrom % d.config.maxSeats, d.config.maxSeats, (seat) => {
    const p = hand.players.find((x) => x.seat === seat);
    return p !== undefined && needsToAct(hand, p);
  });
  if (next !== null) {
    hand.toAct = next;
    return;
  }

  hand.toAct = null;
  const canAct = live.filter((p) => !p.allIn);
  if (hand.street === 'river') return settle(d);
  if (canAct.length <= 1) {
    while (hand.board.length < 5) dealStreet(d);
    return settle(d);
  }
  dealStreet(d);
  proceed(d, hand.buttonSeat + 1);
}

function dealStreet(d: Draft): void {
  const hand = d.hand!;
  const street = hand.street === 'preflop' ? 'flop' : hand.street === 'flop' ? 'turn' : 'river';
  hand.deck.shift(); // burn
  const cards = hand.deck.splice(0, street === 'flop' ? 3 : 1);
  hand.board.push(...cards);
  hand.street = street;
  hand.currentBet = 0;
  hand.minRaise = d.config.bigBlind;
  hand.lastAggressorSeat = null;
  for (const p of hand.players) {
    p.streetBet = 0;
    p.hasActed = false;
    p.actedAtBet = 0;
  }
  d.events.push({ type: 'streetDealt', street, cards });
}

/**
 * Awards every pot and decides who shows. If anyone still in is all-in, every hand is shown (TDA
 * all-in exposure). Otherwise the last aggressor of the final round shows first (the first player
 * left of the button if nobody bet), and the others show only to claim a pot: losers muck.
 */
function settle(d: Draft): void {
  const hand = d.hand!;
  const { maxSeats } = d.config;
  const live = hand.players.filter((p) => !p.folded);
  const evaluated: ShowdownHand[] =
    live.length >= 2
      ? live.map((p) => {
          const best = bestHand([...p.holeCards, ...hand.board]);
          return {
            seat: p.seat,
            holeCards: p.holeCards,
            category: best.category,
            bestCards: best.cards,
            value: best.value,
          };
        })
      : [];

  const awards: PotAward[] = buildPots(hand.players, hand.deadMoney).map((pot) => {
    let winnerSeats = pot.eligibleSeats;
    if (winnerSeats.length > 1) {
      const contenders = evaluated.filter((h) => pot.eligibleSeats.includes(h.seat));
      const top = contenders.reduce((a, b) => (compareHands(a, b) >= 0 ? a : b));
      winnerSeats = contenders.filter((h) => compareHands(h, top) === 0).map((h) => h.seat);
    }
    return { ...pot, winners: splitPot(pot.amount, winnerSeats, hand.buttonSeat, maxSeats) };
  });

  let showdown: ShowdownHand[] = [];
  let mucked: number[] = [];
  if (evaluated.length > 0) {
    const isLive = (seat: number) => live.some((p) => p.seat === seat);
    const aggressor = hand.lastAggressorSeat;
    const firstToShow =
      aggressor !== null && isLive(aggressor)
        ? aggressor
        : findSeatFrom(hand.buttonSeat + 1, maxSeats, isLive)!;
    const showingOrder = (seat: number) => (seat - firstToShow + maxSeats) % maxSeats;
    const potWinners = new Set(
      awards.filter((a) => a.eligibleSeats.length > 1).flatMap((a) => a.winners.map((w) => w.seat)),
    );
    const showAll = live.some((p) => p.allIn);
    const ordered = [...evaluated].sort((a, b) => showingOrder(a.seat) - showingOrder(b.seat));
    showdown = ordered.filter((h) => showAll || h.seat === firstToShow || potWinners.has(h.seat));
    mucked = ordered.filter((h) => !showdown.includes(h)).map((h) => h.seat);
    d.events.push({ type: 'showdown', hands: showdown, mucked });
  }

  awards.forEach((award, potIndex) => {
    for (const w of award.winners) d.seats[w.seat]!.stack += w.amount;
    d.events.push({ type: 'potAwarded', potIndex, ...award });
  });

  hand.street = 'settled';
  hand.toAct = null;
  hand.awards = awards;
  hand.showdown = showdown;
  hand.mucked = mucked;
  d.events.push({
    type: 'handSettled',
    handNumber: hand.handNumber,
    stacks: hand.players.map((p) => ({ seat: p.seat, stack: d.seats[p.seat]!.stack })),
  });
  freeLeavingSeats(d);
  for (const [seat, s] of d.seats.entries()) {
    if (s && s.status === 'seated' && s.stack === 0) {
      s.status = 'sitting_out';
      d.events.push({ type: 'playerSatOut', seat, playerId: s.playerId });
    }
  }
}

// ---------------------------------------------------------------- helpers

function freeLeavingSeats(d: Draft): void {
  for (const [seat, s] of d.seats.entries()) if (s?.status === 'leaving') removeSeat(d, seat);
}

function removeSeat(d: Draft, seat: number): void {
  const s = d.seats[seat]!;
  d.seats[seat] = null;
  d.events.push({ type: 'playerLeft', seat, playerId: s.playerId, cashOut: s.stack });
}

function markLeaving(d: Draft, seat: number): void {
  const s = d.seats[seat];
  // The seat may already be gone if the fold settled the hand.
  if (s) s.status = 'leaving';
  if (d.hand && !isHandInProgress(d.hand)) freeLeavingSeats(d);
}

function seatOf(state: TableState, playerId: string): number {
  return state.seats.findIndex((s) => s?.playerId === playerId);
}

function playerAt(d: Draft, seat: number): DraftPlayer {
  return d.hand!.players.find((p) => p.seat === seat)!;
}

function toDraft(state: TableState, events: readonly HoldemEvent[] = []): Draft {
  const hand = state.hand;
  return {
    config: state.config,
    seats: state.seats.map((s) => (s ? { ...s } : null)),
    buttonSeat: state.buttonSeat,
    smallBlindPosition: state.smallBlindPosition,
    bigBlindSeat: state.bigBlindSeat,
    handNumber: state.handNumber,
    hand: hand
      ? {
          ...hand,
          deck: [...hand.deck],
          board: [...hand.board],
          players: hand.players.map((p) => ({ ...p })),
          mucked: [...hand.mucked],
        }
      : null,
    events: [...events],
  };
}

function done(d: Draft): HoldemResult {
  const { events, ...state } = d;
  return { ok: true, state, events };
}

function fail(code: HoldemErrorCode, message: string): HoldemResult {
  return { ok: false, error: { code, message } };
}
