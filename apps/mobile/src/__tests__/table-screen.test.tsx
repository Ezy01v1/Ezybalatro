import type { SeatView } from '@naipes/engine';
import type { Ack, TableUpdate } from '@naipes/shared';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TableScreen } from '@/components/table/TableScreen';
import type { ClientEvent, TableClient } from '@/table/tableClient';
import { createTableStore } from '@/table/tableStore';

let mockNet: { isConnected: boolean | null } = { isConnected: true };
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: () => mockNet }));

function makeClient() {
  let listener: (e: ClientEvent) => void = () => {};
  const ok = (): Promise<Ack> => Promise.resolve({ ok: true });
  const client = {
    connect: jest.fn(),
    quickSeat: jest.fn(() => Promise.resolve({ ok: true as const, tableId: 't', seat: 0 })),
    act: jest.fn(ok),
    sitOut: jest.fn(ok),
    sitIn: jest.fn(ok),
    leave: jest.fn(() => Promise.resolve({ ok: true as const, cashOut: 1480 })),
    sync: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn((l: (e: ClientEvent) => void) => {
      listener = l;
      return () => {};
    }),
  };
  return {
    client: client as unknown as TableClient & typeof client,
    emit: (e: ClientEvent) => listener(e),
  };
}

const seat = (i: number, stack: number): SeatView => ({
  seat: i,
  playerId: `p${i}`,
  stack,
  status: 'seated',
  owesBigBlind: false,
  owesSmallBlind: false,
  postBlindsToEnter: false,
});

function update(opts: { seq?: number; myTurn?: boolean } = {}): TableUpdate {
  const player = (i: number) => ({
    seat: i,
    playerId: `p${i}`,
    streetBet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    holeCards: null,
  });
  return {
    tableId: 't',
    seq: opts.seq ?? 1,
    events: [],
    turn: { seat: opts.myTurn ? 0 : 1, endsInMs: 20000 },
    names: { p0: 'Yo', p1: 'Sol' },
    view: {
      config: { maxSeats: 6, smallBlind: 10, bigBlind: 20, minBuyIn: 400, maxBuyIn: 2000 },
      seats: [seat(0, 1000), seat(1, 2000), null, null, null, null],
      handNumber: 1,
      mySeat: 0,
      legal: opts.myTurn
        ? { canCheck: true, callAmount: 0, bet: { min: 20, max: 1000 }, raise: null }
        : null,
      hand: {
        handNumber: 1,
        street: 'flop',
        buttonSeat: 0,
        smallBlindSeat: 0,
        bigBlindSeat: 1,
        board: [],
        players: [player(0), player(1)],
        currentBet: 0,
        minRaise: 20,
        toAct: opts.myTurn ? 0 : 1,
        pot: 40,
        awards: [],
        showdown: [],
        mucked: [],
      },
    },
  } as unknown as TableUpdate;
}

async function setup() {
  const h = makeClient();
  const store = createTableStore(h.client);
  const onExit = jest.fn();
  await render(<TableScreen useStore={store} balance={8500} onExit={onExit} />);
  return { ...h, store, onExit };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockNet = { isConnected: true };
});
afterEach(() => jest.useRealTimers());

describe('TableScreen', () => {
  it('starts on mount and shows the table after the first update', async () => {
    const { client, emit } = await setup();
    expect(client.connect).toHaveBeenCalled();
    expect(screen.getByText('Buscando mesa…')).toBeTruthy();
    await act(async () => emit({ type: 'update', update: update() }));
    expect(screen.queryByText('Buscando mesa…')).toBeNull();
    expect(screen.getByText('Ciegas 10/20')).toBeTruthy();
    expect(screen.getByText('8.500')).toBeTruthy();
    expect(screen.getByText('Esperando a Sol…')).toBeTruthy();
    expect(screen.getByLabelText('Sol, 2.000 fichas, su turno')).toBeTruthy();
    expect(screen.getByText('Bote 40')).toBeTruthy();
  });

  it('my turn: bet through the selector', async () => {
    const { client, emit } = await setup();
    await act(async () => emit({ type: 'update', update: update({ myTurn: true }) }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apostar' }));
    await fireEvent.press(screen.getByText('Apostar 20'));
    expect(client.act).toHaveBeenCalledWith(1, { type: 'bet', amount: 20 });
  });

  it('keeps the chosen amount across updates of the same turn; a new range resets it', async () => {
    const { emit } = await setup();
    await act(async () => emit({ type: 'update', update: update({ myTurn: true }) }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apostar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Subir monto' }));
    expect(screen.getByText('Apostar 40')).toBeTruthy();
    await act(async () => emit({ type: 'update', update: update({ myTurn: true, seq: 2 }) }));
    expect(screen.getByText('Apostar 40')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Subir monto' }));
    expect(screen.getByText('Apostar 60')).toBeTruthy();
    const base = update({ myTurn: true, seq: 3 });
    const changed = {
      ...base,
      view: { ...base.view, legal: { ...base.view.legal!, bet: { min: 40, max: 900 } } },
    } as TableUpdate;
    await act(async () => emit({ type: 'update', update: changed }));
    expect(screen.getByText('Apostar 40')).toBeTruthy();
  });

  it('leaving mid-hand asks first, then shows the summary', async () => {
    const { client, emit, onExit } = await setup();
    await act(async () => emit({ type: 'update', update: update() }));
    await fireEvent.press(screen.getByRole('button', { name: 'Menú de la mesa' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Salir de la mesa' }));
    expect(screen.getByText('Si sales ahora, te retiras de esta mano. ¿Salir?')).toBeTruthy();
    expect(client.leave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Salir' }));
    expect(client.leave).toHaveBeenCalled();
    expect(screen.getByText('Te levantaste con 1.480 fichas')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver al menú' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('losing the network shows "Reconectando…" right away and blocks actions', async () => {
    const { emit } = await setup();
    await act(async () => emit({ type: 'update', update: update({ myTurn: true }) }));
    expect(screen.queryByText('Reconectando…')).toBeNull();
    mockNet = { isConnected: false };
    await act(async () => emit({ type: 'update', update: update({ myTurn: true, seq: 2 }) }));
    expect(screen.getByText('Reconectando…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apostar' })).toBeDisabled();
  });

  it('server close and session replaced dialogs', async () => {
    const { emit, client } = await setup();
    await act(async () => emit({ type: 'update', update: update() }));
    await act(async () => emit({ type: 'closed' } as ClientEvent));
    expect(screen.getByText('La mesa se cerró. Tus fichas volvieron a tu saldo.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Buscar otra mesa' }));
    expect(client.connect).toHaveBeenCalledTimes(2);
    await act(async () => emit({ type: 'replaced' } as ClientEvent));
    expect(screen.getByText('Abriste la mesa en otro dispositivo.')).toBeTruthy();
  });
});
