import type { Ack, TableUpdate } from '@naipes/shared';
import type { ClientEvent, TableClient } from '../table/tableClient';
import { createTableStore } from '../table/tableStore';

function makeClient() {
  let listener: (e: ClientEvent) => void = () => {};
  const ok = (): Promise<Ack> => Promise.resolve({ ok: true });
  const client = {
    connect: jest.fn(),
    quickSeat: jest.fn((): Promise<Ack<{ tableId: string; seat: number }>> =>
      Promise.resolve({ ok: true, tableId: 't1', seat: 0 }),
    ),
    act: jest.fn((): Promise<Ack> => ok()),
    sitOut: jest.fn((): Promise<Ack> => ok()),
    sitIn: jest.fn((): Promise<Ack> => ok()),
    leave: jest.fn((): Promise<Ack<{ cashOut: number | null }>> =>
      Promise.resolve({ ok: true, cashOut: 1234 }),
    ),
    sync: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn((l: (e: ClientEvent) => void) => {
      listener = l;
      return () => {};
    }),
  };
  return { client: client as TableClient & typeof client, emit: (e: ClientEvent) => listener(e) };
}

const upd = (seq: number): TableUpdate =>
  ({
    tableId: 't1',
    seq,
    events: [],
    view: { seats: [] },
    turn: null,
    names: {},
  }) as unknown as TableUpdate;
const status = (s: Extract<ClientEvent, { type: 'status' }>['status']): ClientEvent => ({
  type: 'status',
  status: s,
});
const err = (code: string) =>
  ({ type: 'error', code, message: 'x' }) as Extract<ClientEvent, { type: 'error' }>['error'];

function setup() {
  const h = makeClient();
  let t = 1000;
  const store = createTableStore(h.client, () => t);
  return { ...h, store, tick: (n: number) => (t += n) };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('tableStore', () => {
  it('start → connecting → waking after 5000 ms → seated on first update', () => {
    const { store, emit, client } = setup();
    store.getState().start(500);
    expect(store.getState().status).toBe('connecting');
    expect(client.connect).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(4999);
    expect(store.getState().status).toBe('connecting');
    jest.advanceTimersByTime(1);
    expect(store.getState().status).toBe('waking');
    emit(status('connected'));
    expect(client.quickSeat).toHaveBeenCalledWith(500);
    emit({ type: 'update', update: upd(1) });
    expect(store.getState().status).toBe('seated');
    expect(store.getState().update?.seq).toBe(1);
  });

  it('failed after 90000 ms without a table', () => {
    const { store, client } = setup();
    store.getState().start();
    jest.advanceTimersByTime(90000);
    expect(store.getState().status).toBe('failed');
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('a disconnect while seated goes to reconnecting, the next update back to seated', () => {
    const { store, emit } = setup();
    store.getState().start();
    emit({ type: 'update', update: upd(1) });
    emit(status('reconnecting'));
    expect(store.getState().status).toBe('reconnecting');
    emit({ type: 'update', update: upd(2) });
    expect(store.getState().status).toBe('seated');
    expect(store.getState().prev?.seq).toBe(1);
  });

  it('ignores an update with seq <= current', () => {
    const { store, emit } = setup();
    store.getState().start();
    emit({ type: 'update', update: upd(5) });
    emit({ type: 'update', update: upd(5) });
    emit({ type: 'update', update: upd(3) });
    expect(store.getState().update?.seq).toBe(5);
    expect(store.getState().prev).toBeNull();
  });

  it('records when the update arrived', () => {
    const { store, emit, tick } = setup();
    store.getState().start();
    tick(250);
    emit({ type: 'update', update: upd(1) });
    expect(store.getState().turnReceivedAt).toBe(1250);
  });

  it('act sets pendingAction until the next update or error', async () => {
    const { store, emit, client } = setup();
    store.getState().start();
    emit({ type: 'update', update: upd(1) });
    await store.getState().act({ type: 'fold' });
    expect(client.act).toHaveBeenCalledWith(1, { type: 'fold' });
    expect(store.getState().pendingAction).toBe(true);
    emit({ type: 'update', update: upd(2) });
    expect(store.getState().pendingAction).toBe(false);

    await store.getState().act({ type: 'check' });
    expect(store.getState().pendingAction).toBe(true);
    emit({ type: 'error', error: err('NOT_YOUR_TURN') });
    expect(store.getState().pendingAction).toBe(false);
  });

  it.each(['STALE_SEQ', 'NOT_YOUR_TURN', 'INVALID_AMOUNT'])(
    '%s sets a toast and calls sync',
    (code) => {
      const { store, emit, client } = setup();
      store.getState().start();
      emit({ type: 'error', error: err(code) });
      expect(store.getState().toast).toBeTruthy();
      expect(store.getState().toast).not.toContain(code);
      expect(client.sync).toHaveBeenCalledTimes(1);
      store.getState().dismissToast();
      expect(store.getState().toast).toBeNull();
    },
  );

  it('an act ack failure shows the toast and syncs', async () => {
    const { store, emit, client } = setup();
    store.getState().start();
    emit({ type: 'update', update: upd(1) });
    client.act.mockResolvedValueOnce({ ok: false, error: err('STALE_SEQ') });
    await store.getState().act({ type: 'fold' });
    expect(store.getState().pendingAction).toBe(false);
    expect(store.getState().toast).toBeTruthy();
    expect(client.sync).toHaveBeenCalled();
  });

  it('closed and replaced are terminal', () => {
    const a = setup();
    a.store.getState().start();
    a.emit({ type: 'update', update: upd(1) });
    a.emit({ type: 'closed', closed: { tableId: 't1', reason: 'empty' } });
    a.emit(status('reconnecting'));
    expect(a.store.getState().status).toBe('closed');

    const b = setup();
    b.store.getState().start();
    b.emit({ type: 'update', update: upd(1) });
    b.emit({ type: 'replaced' });
    b.emit(status('reconnecting'));
    expect(b.store.getState().status).toBe('replaced');
  });

  it('leave stores leftWith from cashOut', async () => {
    const { store, emit } = setup();
    store.getState().start();
    emit({ type: 'update', update: upd(1) });
    await store.getState().leave();
    expect(store.getState().leftWith).toBe(1234);
    expect(store.getState().status).toBe('closed');
  });

  it('start twice sends a single quickSeat', () => {
    const { store, emit, client } = setup();
    store.getState().start();
    store.getState().start();
    emit(status('connected'));
    emit(status('connected'));
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.quickSeat).toHaveBeenCalledTimes(1);
  });

  it('quickSeat error → failed with error', async () => {
    const { store, emit, client } = setup();
    client.quickSeat.mockResolvedValueOnce({ ok: false, error: err('INSUFFICIENT_FUNDS') });
    store.getState().start();
    emit(status('connected'));
    await Promise.resolve();
    expect(store.getState().status).toBe('failed');
    expect(store.getState().error?.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('degraded true/false toggles the flag', () => {
    const { store, emit } = setup();
    store.getState().start();
    emit({ type: 'degraded', degraded: { tableId: 't1', degraded: true } });
    expect(store.getState().degraded).toBe(true);
    emit({ type: 'degraded', degraded: { tableId: 't1', degraded: false } });
    expect(store.getState().degraded).toBe(false);
  });

  it('background for 10000 ms disconnects; foreground reconnects', async () => {
    const { store, emit, client } = setup();
    store.getState().start();
    emit({ type: 'update', update: upd(1) });
    store.getState().onAppState('background');
    jest.advanceTimersByTime(9999);
    expect(client.disconnect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    store.getState().onAppState('active');
    expect(client.connect).toHaveBeenCalledTimes(2);
    expect(store.getState().status).toBe('reconnecting');
    emit(status('connected'));
    expect(client.quickSeat).toHaveBeenCalledTimes(1);
  });

  it('a quick return from the background keeps the socket', () => {
    const { store, emit, client } = setup();
    store.getState().start();
    emit({ type: 'update', update: upd(1) });
    store.getState().onAppState('background');
    jest.advanceTimersByTime(5000);
    store.getState().onAppState('active');
    jest.advanceTimersByTime(20000);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('retry after failed starts again; reset returns to idle', () => {
    const { store, client } = setup();
    store.getState().start(200);
    jest.advanceTimersByTime(90000);
    store.getState().retry();
    expect(store.getState().status).toBe('connecting');
    expect(client.connect).toHaveBeenCalledTimes(2);
    store.getState().reset();
    expect(store.getState().status).toBe('idle');
  });

  it('reconnecting for 90000 ms without an update goes to failed', () => {
    const { store, emit } = setup();
    store.getState().start();
    emit({ type: 'update', update: upd(1) });
    emit(status('reconnecting'));
    jest.advanceTimersByTime(89999);
    expect(store.getState().status).toBe('reconnecting');
    jest.advanceTimersByTime(1);
    expect(store.getState().status).toBe('failed');
  });

  it('an update while reconnecting cancels the failure timer', () => {
    const { store, emit } = setup();
    store.getState().start();
    emit({ type: 'update', update: upd(1) });
    emit(status('reconnecting'));
    jest.advanceTimersByTime(60000);
    emit({ type: 'update', update: upd(2) });
    jest.advanceTimersByTime(60000);
    expect(store.getState().status).toBe('seated');
  });

  it('a background return that never gets the table goes to failed', () => {
    const { store, emit } = setup();
    store.getState().start();
    emit({ type: 'update', update: upd(1) });
    store.getState().onAppState('background');
    jest.advanceTimersByTime(10000);
    store.getState().onAppState('active');
    jest.advanceTimersByTime(90000);
    expect(store.getState().status).toBe('failed');
  });

  it('a late quickSeat failure after reset is ignored', async () => {
    const { store, emit, client } = setup();
    let resolve: (a: Ack<{ tableId: string; seat: number }>) => void = () => {};
    client.quickSeat.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    store.getState().start();
    emit(status('connected'));
    store.getState().reset();
    resolve({ ok: false, error: err('INTERNAL') });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().status).toBe('idle');
    store.getState().start();
    emit(status('connected'));
    expect(client.quickSeat).toHaveBeenCalledTimes(2);
  });

  it('rejected requests clear pendingAction and show a toast', async () => {
    const { store, emit, client } = setup();
    store.getState().start();
    emit({ type: 'update', update: upd(1) });
    client.act.mockRejectedValueOnce(new Error('boom'));
    await store.getState().act({ type: 'fold' });
    expect(store.getState().pendingAction).toBe(false);
    expect(store.getState().toast).toBeTruthy();
    client.sitOut.mockRejectedValueOnce(new Error('boom'));
    store.getState().dismissToast();
    await store.getState().sitOut();
    expect(store.getState().toast).toBeTruthy();
    client.leave.mockRejectedValueOnce(new Error('boom'));
    store.getState().dismissToast();
    await store.getState().leave();
    expect(store.getState().toast).toBeTruthy();
    expect(store.getState().status).toBe('seated');
  });
});
