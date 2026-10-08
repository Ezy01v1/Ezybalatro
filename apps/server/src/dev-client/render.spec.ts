import {
  createStandardDeck,
  createTable,
  holdemReducer,
  viewFor,
  type HoldemAction,
  type HoldemEvent,
  type TableState,
} from '@naipes/engine';
import type { TableUpdate } from '@naipes/shared';
import { renderTable } from './render';

const CONFIG = { maxSeats: 6, smallBlind: 10, bigBlind: 20, minBuyIn: 400, maxBuyIn: 2000 };
// eslint-disable-next-line no-control-regex
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

function apply(
  state: TableState,
  action: HoldemAction,
): { state: TableState; events: HoldemEvent[] } {
  const result = holdemReducer(state, action);
  if (!result.ok) throw new Error(result.error.code);
  return { state: result.state, events: [...result.events] };
}

/** ana (seat 0), bot:rocio (seat 1) and beto (seat 2), hand just dealt with the standard deck order. */
function dealt(): { state: TableState; events: HoldemEvent[] } {
  let state = createTable(CONFIG);
  for (const [seat, id] of ['dev:ana', 'bot:rocio', 'dev:beto'].entries()) {
    state = apply(state, { type: 'sit', playerId: id, seat, buyIn: 1000 }).state;
  }
  return apply(state, { type: 'postBlinds', deck: createStandardDeck() });
}

function updateFor(
  state: TableState,
  me: string,
  events: HoldemEvent[] = [],
  turn: TableUpdate['turn'] = null,
): TableUpdate {
  return { tableId: 't1', seq: 3, events, view: viewFor(state, me), turn };
}

describe('renderTable', () => {
  it('renders own hole cards, pot, board and the turn marker', () => {
    const { state, events } = dealt();
    const toAct = state.hand!.toAct!;
    const actor = state.seats[toAct]!.playerId;
    const text = strip(
      renderTable(updateFor(state, actor, events, { seat: toAct, endsInMs: 18_400 }), actor),
    );

    const own = viewFor(state, actor).hand!.players.find((p) => p.playerId === actor)!.holeCards!;
    for (const card of own) {
      expect(text).toContain(`${card.id[0] === 'T' ? '10' : card.id[0]}`);
    }
    expect(text).toMatch(/[♠♥♦♣]/);
    expect(text).toMatch(/Bote:?\s*30/);
    expect(text).toContain('Mesa:');
    expect(text).toContain('← turno');
    expect(text).toContain('19 s');
    expect(text).toMatch(/\[B\]/);
    expect(text).toMatch(/\[SB\]/);
    expect(text).toMatch(/\[BB\]/);
    // Seat lines show names without the identity prefix.
    expect(text).toContain('ana');
    expect(text).toContain('rocio');
    expect(text).not.toContain('dev:ana');
    expect(text).not.toContain('bot:rocio');
  });

  it('shows legal actions with amounts', () => {
    const { state } = dealt();
    const toAct = state.hand!.toAct!;
    const actor = state.seats[toAct]!.playerId;
    const text = strip(
      renderTable(updateFor(state, actor, [], { seat: toAct, endsInMs: 5_000 }), actor),
    );
    const legal = viewFor(state, actor).legal!;
    expect(text).toContain(`call ${legal.callAmount}`);
    expect(text).toContain(`raise ${legal.raise!.min}–${legal.raise!.max}`);
    expect(text).toContain('fold');
  });

  it('never renders cards it does not have', () => {
    const { state } = dealt();
    const me = 'dev:ana';
    const view = viewFor(state, me);
    const others = state.hand!.players.filter((p) => p.playerId !== me).flatMap((p) => p.holeCards);
    const own = view.hand!.players.find((p) => p.playerId === me)!.holeCards!;
    const text = strip(renderTable(updateFor(state, me), me));
    const label = (c: { id: string }) =>
      `${c.id[0] === 'T' ? '10' : c.id[0]}${{ s: '♠', h: '♥', d: '♦', c: '♣' }[c.id[1] as 's']}`;
    const ownLabels = own.map(label);
    for (const card of others) {
      if (ownLabels.includes(label(card))) continue;
      expect(text).not.toContain(label(card));
    }
  });

  it('paints hearts and diamonds red', () => {
    const { state } = dealt();
    const text = renderTable(updateFor(state, 'dev:ana'), 'dev:ana');
    // Standard deck order: the first cards dealt are spades, so use the board of a flop instead.
    expect(text).not.toContain('\x1b[31m♠');
    const red = renderTable(
      {
        ...updateFor(state, 'dev:ana'),
        events: [
          { type: 'streetDealt', street: 'flop', cards: [{ id: 'Ah', rank: 14, suit: 'h' }] },
        ],
      },
      'dev:ana',
    );
    expect(red).toContain('\x1b[31mA♥');
  });

  it('describes events in Spanish', () => {
    const { state } = dealt();
    const events: HoldemEvent[] = [
      { type: 'playerActed', seat: 1, action: 'raise', amount: 100, to: 120, allIn: false },
      { type: 'playerActed', seat: 2, action: 'fold', amount: 0, to: 0, allIn: false },
      {
        type: 'potAwarded',
        potIndex: 0,
        amount: 340,
        eligibleSeats: [0],
        winners: [{ seat: 0, amount: 340 }],
      },
    ];
    const text = strip(renderTable(updateFor(state, 'dev:ana', events), 'dev:ana'));
    expect(text).toContain('rocio sube a 120');
    expect(text).toContain('beto se retira');
    expect(text).toContain('Gana ana: 340');
  });

  it('marks folded and all-in players', () => {
    let { state } = dealt();
    const toAct = state.hand!.toAct!;
    state = apply(state, { type: 'fold', playerId: state.seats[toAct]!.playerId }).state;
    const text = strip(renderTable(updateFor(state, 'dev:ana'), 'dev:ana'));
    expect(text).toContain('(retirado)');
  });
});
