import type { Card, HandPlayerView, HoldemEvent, LegalActions, SeatView } from '@naipes/engine';
import type { TableUpdate } from '@naipes/shared';
import { diff, quickAmounts, toTableModel } from '../table/viewModel';

const c = (id: string, rank: number, suit: string): Card => ({ id, rank, suit }) as Card;
const AH = c('Ah', 14, 'h');
const KH = c('Kh', 13, 'h');

function seat(i: number, stack = 1000, status: SeatView['status'] = 'seated'): SeatView {
  return {
    seat: i,
    playerId: `p${i}`,
    stack,
    status,
    owesBigBlind: false,
    owesSmallBlind: false,
    postBlindsToEnter: false,
  };
}
function player(i: number, extra: Partial<HandPlayerView> = {}): HandPlayerView {
  return {
    seat: i,
    playerId: `p${i}`,
    streetBet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    holeCards: null,
    ...extra,
  };
}

function makeUpdate(opts: {
  maxSeats?: number;
  occupied?: number[];
  mySeat?: number | null;
  seats?: (SeatView | null)[];
  hand?: Partial<NonNullable<TableUpdate['view']['hand']>> | null;
  legal?: LegalActions | null;
  turn?: TableUpdate['turn'];
  events?: HoldemEvent[];
}): TableUpdate {
  const maxSeats = opts.maxSeats ?? 6;
  const occupied = opts.occupied ?? [0, 1];
  const seats =
    opts.seats ??
    Array.from({ length: maxSeats }, (_, i) => (occupied.includes(i) ? seat(i) : null));
  const names: Record<string, string> = {};
  seats.forEach((s) => s && (names[s.playerId] = `N${s.seat}`));
  return {
    tableId: 't',
    seq: 1,
    events: opts.events ?? [],
    turn: opts.turn ?? null,
    names,
    view: {
      config: { maxSeats, smallBlind: 10, bigBlind: 20, minBuyIn: 400, maxBuyIn: 2000 },
      seats,
      handNumber: 1,
      mySeat: opts.mySeat === undefined ? 0 : opts.mySeat,
      legal: opts.legal ?? null,
      hand:
        opts.hand === null || opts.hand === undefined
          ? null
          : {
              handNumber: 1,
              street: 'preflop',
              buttonSeat: 0,
              smallBlindSeat: 0,
              bigBlindSeat: 1,
              board: [],
              players: [],
              currentBet: 0,
              minRaise: 20,
              toAct: null,
              pot: 0,
              awards: [],
              showdown: [],
              mucked: [],
              ...opts.hand,
            },
    },
  };
}
const T = { now: 1000, receivedAt: 1000 };

describe('seat rotation', () => {
  it.each([
    [2, 1, [0]],
    [4, 2, [3, 0, 1]],
    [6, 3, [4, 5, 0, 1, 2]],
  ])('maxSeats %i, mySeat %i', (maxSeats, mySeat, expected) => {
    const m = toTableModel(makeUpdate({ maxSeats, mySeat, occupied: [mySeat] }), T);
    expect(m.hero?.seat).toBe(mySeat);
    expect(m.seats.map((s) => s.seat)).toEqual(expected);
    expect(m.seats.every((s) => s.state === 'empty')).toBe(true);
  });
  it('spectator: hero null without throwing', () => {
    const m = toTableModel(makeUpdate({ mySeat: null }), T);
    expect(m.hero).toBeNull();
    expect(m.seats).toHaveLength(5);
  });
});

describe('seat states', () => {
  it('turn, folded, allIn, sittingOut, waiting, button, names', () => {
    const seats = [seat(0), seat(1), seat(2), seat(3, 500, 'sitting_out'), seat(4), null];
    const m = toTableModel(
      makeUpdate({
        seats,
        turn: { seat: 1, endsInMs: 20000 },
        hand: {
          buttonSeat: 4,
          toAct: 1,
          players: [
            player(0),
            player(1, { streetBet: 20 }),
            player(2, { folded: true }),
            player(4, { allIn: true }),
          ],
        },
      }),
      T,
    );
    const by = Object.fromEntries(m.seats.map((s) => [s.seat, s]));
    expect(by[1]).toMatchObject({ state: 'turn', name: 'N1', streetBet: 20 });
    expect(by[2]?.state).toBe('folded');
    expect(by[3]?.state).toBe('sittingOut');
    expect(by[4]).toMatchObject({ state: 'allIn', isButton: true });
    expect(by[5]?.state).toBe('empty');
    expect(m.hero?.state).toBe('waiting');
    expect(m.blinds).toEqual({ small: 10, big: 20 });
  });
  it('winner with amount and hand label', () => {
    const m = toTableModel(
      makeUpdate({
        hand: {
          street: 'settled',
          players: [player(0, { holeCards: [AH, KH] }), player(1, { holeCards: [AH, KH] })],
          awards: [{ amount: 320, eligibleSeats: [0, 1], winners: [{ seat: 1, amount: 320 }] }],
          showdown: [
            { seat: 0, holeCards: [AH, KH], category: 'pair', bestCards: [], value: 1 },
            { seat: 1, holeCards: [AH, KH], category: 'full_house', bestCards: [], value: 2 },
          ],
        },
      }),
      T,
    );
    expect(m.seats[0]).toMatchObject({ seat: 1, state: 'winner', won: 320 });
    expect(m.handLabel).toBe('Full');
    expect(m.pots).toEqual({ main: 320, sides: [] });
  });
  it('royal flush label', () => {
    const m = toTableModel(
      makeUpdate({
        hand: {
          street: 'settled',
          awards: [{ amount: 40, eligibleSeats: [0], winners: [{ seat: 0, amount: 40 }] }],
          showdown: [
            {
              seat: 0,
              holeCards: [AH, KH],
              category: 'straight_flush',
              bestCards: [AH, KH],
              value: 9,
            },
          ],
        },
      }),
      T,
    );
    expect(m.handLabel).toBe('Escalera real');
  });
});

describe('board, pots and timer', () => {
  it('board has 5 slots', () => {
    const m = toTableModel(makeUpdate({ hand: { board: [AH, KH, AH] } }), T);
    expect(m.board).toEqual([AH, KH, AH, null, null]);
  });
  it('side pots during the hand', () => {
    const m = toTableModel(
      makeUpdate({
        occupied: [0, 1, 2],
        hand: {
          pot: 700,
          players: [
            player(0, { totalBet: 100, allIn: true }),
            player(1, { totalBet: 300 }),
            player(2, { totalBet: 300 }),
          ],
        },
      }),
      T,
    );
    expect(m.pots).toEqual({ main: 300, sides: [400] });
  });
  it('timer fraction and low', () => {
    const u = makeUpdate({ turn: { seat: 1, endsInMs: 10000 } });
    expect(toTableModel(u, { receivedAt: 0, now: 0 }).timer).toEqual({
      seat: 1,
      fraction: 0.5,
      low: false,
    });
    expect(toTableModel(u, { receivedAt: 0, now: 6000 }).timer).toEqual({
      seat: 1,
      fraction: 0.2,
      low: true,
    });
    expect(toTableModel(u, { receivedAt: 0, now: 99999 }).timer?.fraction).toBe(0);
  });
});

describe('action bar', () => {
  const legal = (l: Partial<LegalActions>): LegalActions => ({
    seat: 0,
    canCheck: false,
    callAmount: 0,
    bet: null,
    raise: null,
    allIn: 1000,
    ...l,
  });
  it('not my turn: waiting for actor', () => {
    const m = toTableModel(makeUpdate({ hand: { toAct: 1 } }), T);
    expect(m.actionBar).toEqual({ kind: 'waiting', actor: 'N1' });
  });
  it('check / bet', () => {
    const m = toTableModel(
      makeUpdate({ legal: legal({ canCheck: true, bet: { min: 20, max: 1000 } }) }),
      T,
    );
    expect(m.actionBar).toEqual({
      kind: 'turn',
      fold: true,
      middle: { type: 'check' },
      right: { type: 'bet', min: 20, max: 1000 },
    });
  });
  it('call 40 / raise', () => {
    const m = toTableModel(
      makeUpdate({ legal: legal({ callAmount: 40, raise: { min: 80, max: 1000 } }) }),
      T,
    );
    expect(m.actionBar).toMatchObject({
      middle: { type: 'call', amount: 40 },
      right: { type: 'raise', min: 80, max: 1000 },
    });
  });
  it('call all-in (180), raise hidden', () => {
    const seats = [seat(0, 180), seat(1), null, null, null, null];
    const m = toTableModel(makeUpdate({ seats, legal: legal({ callAmount: 180, allIn: 180 }) }), T);
    expect(m.actionBar).toEqual({
      kind: 'turn',
      fold: true,
      middle: { type: 'callAllIn', amount: 180 },
      right: null,
    });
  });
  it('sitting out: sitIn', () => {
    const seats = [seat(0, 500, 'sitting_out'), seat(1), null, null, null, null];
    expect(toTableModel(makeUpdate({ seats }), T).actionBar).toEqual({ kind: 'sitIn' });
  });
});

describe('quickAmounts', () => {
  const base: LegalActions = {
    seat: 0,
    canCheck: false,
    callAmount: 40,
    bet: null,
    raise: null,
    allIn: 500,
  };
  it('raise: pot adds the current bet and is capped', () => {
    expect(quickAmounts({ ...base, raise: { min: 80, max: 500 } }, 300, 40)).toEqual([
      { key: 'min', amount: 80, valid: true },
      { key: 'half', amount: 150, valid: true },
      { key: 'pot', amount: 340, valid: true },
      { key: 'all', amount: 500, valid: true },
    ]);
    expect(quickAmounts({ ...base, raise: { min: 80, max: 300 } }, 300, 40)[2]).toEqual({
      key: 'pot',
      amount: 300,
      valid: true,
    });
  });
  it('half pot below min is invalid', () => {
    const q = quickAmounts({ ...base, bet: { min: 20, max: 1000 } }, 30);
    expect(q[1]).toEqual({ key: 'half', amount: 15, valid: false });
    expect(q[2]).toEqual({ key: 'pot', amount: 30, valid: true });
  });
  it('no bet or raise: empty', () => {
    expect(quickAmounts(base, 100)).toEqual([]);
  });
});

describe('diff', () => {
  it('deal, bets, check, street and board', () => {
    const next = makeUpdate({
      events: [
        {
          type: 'handStarted',
          handNumber: 1,
          buttonSeat: 0,
          smallBlindSeat: 0,
          bigBlindSeat: 1,
          seats: [0, 1],
        },
        { type: 'blindPosted', seat: 0, blind: 'small', amount: 10, allIn: false },
        { type: 'playerActed', seat: 1, action: 'check', amount: 0, to: 20, allIn: false },
        { type: 'streetDealt', street: 'flop', cards: [AH, KH, AH] },
        { type: 'streetDealt', street: 'turn', cards: [KH] },
      ],
    });
    expect(diff(null, next, 5)).toEqual([
      'dealt',
      { bet: 0 },
      'checked',
      'streetClosed',
      { boardRevealed: 3 },
      'streetClosed',
      { boardRevealed: 1 },
    ]);
  });
  it('award, iWon and my all-in', () => {
    const next = makeUpdate({
      events: [
        { type: 'playerActed', seat: 0, action: 'raise', amount: 500, to: 500, allIn: true },
        {
          type: 'potAwarded',
          potIndex: 0,
          amount: 600,
          eligibleSeats: [0, 1],
          winners: [{ seat: 0, amount: 600 }],
        },
      ],
    });
    expect(diff(null, next, 0)).toEqual([
      { bet: 0 },
      'myAllIn',
      'streetClosed',
      { awarded: { seat: 0, amount: 600 } },
      'iWon',
    ]);
  });
  it('my turn starts once', () => {
    const prev = makeUpdate({ hand: {}, turn: { seat: 1, endsInMs: 1 } });
    const next = makeUpdate({ hand: {}, turn: { seat: 0, endsInMs: 20000 } });
    expect(diff(prev, next, 0)).toEqual(['myTurnStarted']);
    expect(diff(next, next, 0)).toEqual([]);
  });
});
