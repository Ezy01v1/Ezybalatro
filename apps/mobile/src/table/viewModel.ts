import { buildPots, type Card } from '@naipes/engine';
import type { LegalActions, TableUpdate } from '@naipes/shared';
import { es } from '../i18n/es';

/**
 * Pure reshaping of the server's `table:update` for the table screen. No game rules: every amount
 * comes from the server (`view.legal`); side pots use the engine's `buildPots`. Time is passed in.
 */

/** Server default `TURN_TIMEOUT_MS` (protocol §8); the update only carries the time left. */
export const TURN_MS = 20_000;
export const LOW_TIME_MS = 5_000;

export type SeatState =
  'empty' | 'waiting' | 'turn' | 'folded' | 'allIn' | 'sittingOut' | 'disconnected' | 'winner';

export interface SeatModel {
  seat: number;
  name: string | null;
  stack: number;
  streetBet: number;
  isButton: boolean;
  state: SeatState;
  won: number | null;
  cards: Card[] | null;
}

export type ActionBarModel =
  | { kind: 'waiting'; actor: string | null }
  | { kind: 'sitIn' }
  | {
      kind: 'turn';
      fold: true;
      middle:
        | { type: 'check' }
        | { type: 'call'; amount: number }
        | { type: 'callAllIn'; amount: number };
      right: { type: 'bet' | 'raise'; min: number; max: number } | null;
    };

export interface TableModel {
  /** Rivals in oval order: 0 = lower left, then clockwise to lower right. Always `maxSeats - 1`. */
  seats: SeatModel[];
  hero: SeatModel | null;
  board: (Card | null)[];
  pots: { main: number; sides: number[] };
  handLabel: string | null;
  actionBar: ActionBarModel;
  timer: { seat: number; fraction: number; low: boolean } | null;
  blinds: { small: number; big: number };
}

function seatModel(update: TableUpdate, seat: number): SeatModel {
  const { view, names, turn } = update;
  const s = view.seats[seat] ?? null;
  const hand = view.hand;
  if (!s) {
    return {
      seat,
      name: null,
      stack: 0,
      streetBet: 0,
      isButton: hand?.buttonSeat === seat,
      state: 'empty',
      won: null,
      cards: null,
    };
  }
  const player = hand?.players.find((p) => p.seat === seat) ?? null;
  const won = hand?.street === 'settled' ? wonBy(update, seat) : null;
  let state: SeatState;
  if (won !== null) state = 'winner';
  else if (turn?.seat === seat) state = 'turn';
  else if (player?.folded) state = 'folded';
  else if (player?.allIn) state = 'allIn';
  else if (s.status === 'sitting_out') state = 'sittingOut';
  else state = 'waiting';
  return {
    seat,
    name: names[s.playerId] ?? null,
    stack: s.stack,
    streetBet: player?.streetBet ?? 0,
    isButton: hand?.buttonSeat === seat,
    state,
    won,
    cards: player?.holeCards ? [...player.holeCards] : null,
  };
}

function wonBy(update: TableUpdate, seat: number): number | null {
  let total = 0;
  let found = false;
  for (const award of update.view.hand?.awards ?? []) {
    for (const w of award.winners) {
      if (w.seat === seat) {
        total += w.amount;
        found = true;
      }
    }
  }
  return found ? total : null;
}

function pots(update: TableUpdate): { main: number; sides: number[] } {
  const hand = update.view.hand;
  if (!hand) return { main: 0, sides: [] };
  if (hand.awards.length > 0) {
    const [main, ...sides] = hand.awards.map((a) => a.amount);
    return { main: main ?? 0, sides };
  }
  const committed = hand.players.reduce((sum, p) => sum + p.totalBet, 0);
  // Layers with a single eligible seat are uncalled bets, not pots: they stay in the main line.
  const layers = buildPots(hand.players, hand.pot - committed);
  const contested = layers.filter((p, i) => i === 0 || p.eligibleSeats.length > 1);
  const main = hand.pot - contested.slice(1).reduce((sum, p) => sum + p.amount, 0);
  return { main, sides: contested.slice(1).map((p) => p.amount) };
}

function handLabel(update: TableUpdate): string | null {
  const hand = update.view.hand;
  if (!hand || hand.showdown.length === 0) return null;
  const winners = new Set(hand.awards.flatMap((a) => a.winners.map((w) => w.seat)));
  const shown = hand.showdown.find((h) => winners.has(h.seat)) ?? hand.showdown[0];
  if (!shown) return null;
  const isRoyal =
    shown.category === 'straight_flush' &&
    shown.bestCards.some((c) => c.rank === 14) &&
    shown.bestCards.some((c) => c.rank === 13);
  return isRoyal ? es.table.royalFlush : es.table.handNames[shown.category];
}

function actionBar(update: TableUpdate): ActionBarModel {
  const { view, names } = update;
  const legal = view.legal;
  const me = view.mySeat === null ? null : (view.seats[view.mySeat] ?? null);
  if (legal) {
    const stack = me?.stack ?? 0;
    const middle = legal.canCheck
      ? ({ type: 'check' } as const)
      : legal.callAmount >= stack
        ? ({ type: 'callAllIn', amount: legal.callAmount } as const)
        : ({ type: 'call', amount: legal.callAmount } as const);
    const right = legal.bet
      ? { type: 'bet' as const, ...legal.bet }
      : legal.raise
        ? { type: 'raise' as const, ...legal.raise }
        : null;
    return { kind: 'turn', fold: true, middle, right };
  }
  if (me?.status === 'sitting_out') return { kind: 'sitIn' };
  const toAct = view.hand?.toAct ?? null;
  const actorId = toAct === null ? null : view.seats[toAct]?.playerId;
  return { kind: 'waiting', actor: actorId ? (names[actorId] ?? null) : null };
}

export function toTableModel(
  update: TableUpdate,
  opts: { now: number; receivedAt: number },
): TableModel {
  const { view } = update;
  const n = view.config.maxSeats;
  const anchor = view.mySeat ?? 0;
  const seats: SeatModel[] = [];
  for (let i = 1; i < n; i++) seats.push(seatModel(update, (anchor + i) % n));
  const board: (Card | null)[] = [0, 1, 2, 3, 4].map((i) => view.hand?.board[i] ?? null);
  let timer: TableModel['timer'] = null;
  if (update.turn) {
    const left = Math.max(0, update.turn.endsInMs - (opts.now - opts.receivedAt));
    timer = {
      seat: update.turn.seat,
      fraction: Math.min(1, left / TURN_MS),
      low: left < LOW_TIME_MS,
    };
  }
  return {
    seats,
    hero: view.mySeat === null ? null : seatModel(update, view.mySeat),
    board,
    pots: pots(update),
    handLabel: handLabel(update),
    actionBar: actionBar(update),
    timer,
    blinds: { small: view.config.smallBlind, big: view.config.bigBlind },
  };
}

export type QuickKey = 'min' | 'half' | 'pot' | 'all';

/**
 * Quick amounts for the bet/raise picker ("to" amounts). For a raise, "Pot" is `currentBet + pot`
 * capped at the max; `currentBet` is the hand's current bet (pass 0 for a bet).
 */
export function quickAmounts(
  legal: LegalActions,
  pot: number,
  currentBet = 0,
): { key: QuickKey; amount: number; valid: boolean }[] {
  const range = legal.raise ?? legal.bet;
  if (!range) return [];
  const { min, max } = range;
  const potAmount = legal.raise ? Math.min(currentBet + pot, max) : Math.min(pot, max);
  const items: [QuickKey, number][] = [
    ['min', min],
    ['half', Math.round(pot / 2)],
    ['pot', potAmount],
    ['all', max],
  ];
  return items.map(([key, amount]) => ({ key, amount, valid: amount >= min && amount <= max }));
}

export type Effect =
  | 'dealt'
  | { boardRevealed: number }
  | { bet: number }
  | 'streetClosed'
  | { awarded: { seat: number; amount: number } }
  | 'myTurnStarted'
  | 'checked'
  | 'myAllIn'
  | 'iWon';

/** Effects to animate/sound for `next`, from its events plus a comparison with `prev`. `bet` carries the seat. */
export function diff(prev: TableUpdate | null, next: TableUpdate, mySeat: number | null): Effect[] {
  const effects: Effect[] = [];
  let iWon = false;
  let streetOpen = false;
  let awarding = false;
  for (const e of next.events) {
    switch (e.type) {
      case 'handStarted':
        effects.push('dealt');
        break;
      case 'blindPosted':
        effects.push({ bet: e.seat });
        streetOpen = true;
        break;
      case 'playerActed':
        if (e.action === 'check') effects.push('checked');
        else if (e.amount > 0) {
          effects.push({ bet: e.seat });
          streetOpen = true;
        }
        if (e.allIn && e.seat === mySeat) effects.push('myAllIn');
        break;
      case 'streetDealt':
        effects.push('streetClosed', { boardRevealed: e.cards.length });
        streetOpen = false;
        break;
      case 'potAwarded':
        if (!awarding && (streetOpen || hadStreetBets(prev))) effects.push('streetClosed');
        awarding = true;
        streetOpen = false;
        for (const w of e.winners) {
          effects.push({ awarded: { seat: w.seat, amount: w.amount } });
          if (w.seat === mySeat) iWon = true;
        }
        break;
      default:
        break;
    }
  }
  if (iWon) effects.push('iWon');
  const myTurn = mySeat !== null && next.turn?.seat === mySeat;
  const wasMyTurn =
    prev !== null &&
    prev.turn?.seat === mySeat &&
    prev.view.hand?.handNumber === next.view.hand?.handNumber &&
    prev.view.hand?.street === next.view.hand?.street;
  if (myTurn && !wasMyTurn) effects.push('myTurnStarted');
  return effects;
}

function hadStreetBets(update: TableUpdate | null): boolean {
  return update?.view.hand?.players.some((p) => p.streetBet > 0) ?? false;
}
