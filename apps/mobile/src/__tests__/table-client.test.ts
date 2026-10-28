import { createTableClient, type ClientEvent } from '../table/tableClient';

type Handler = (...args: any[]) => void;

class FakeSocket {
  connected = false;
  handlers = new Map<string, Handler>();
  emitted: { event: string; payload: unknown }[] = [];
  connect = jest.fn();
  disconnect = jest.fn();
  constructor(
    public url: string,
    public opts: { auth: (cb: (d: object) => void) => void },
  ) {}
  on(event: string, handler: Handler) {
    this.handlers.set(event, handler);
    return this;
  }
  fire(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.(...args);
  }
  emit(event: string, payload: unknown) {
    this.emitted.push({ event, payload });
  }
  timeout() {
    return {
      emit: (event: string, payload: unknown, cb: Handler) => {
        this.emitted.push({ event, payload });
        cb(null, { ok: true, tableId: 't1', seat: 2 });
      },
    };
  }
}

const validUpdate = {
  tableId: 't1',
  seq: 4,
  events: [],
  view: { seats: [] },
  turn: null,
  names: {},
};

function setup(getToken: () => Promise<string | null> = async () => 'tok') {
  let fake!: FakeSocket;
  const io = ((url: string, opts: any) => (fake = new FakeSocket(url, opts))) as any;
  const client = createTableClient({ url: 'http://srv', getToken, io });
  const events: ClientEvent[] = [];
  client.on((e) => events.push(e));
  client.connect();
  return { client, events, socket: () => fake };
}

const statuses = (events: ClientEvent[]) =>
  events.flatMap((e) => (e.type === 'status' ? [e.status] : []));

describe('tableClient', () => {
  it('connects with auth.token from getToken', async () => {
    const { socket } = setup(async () => 'abc');
    const data = await new Promise<object>((resolve) => socket().opts.auth(resolve));
    expect(data).toEqual({ token: 'abc' });
    expect(socket().url).toBe('http://srv');
  });

  it('emits update for a valid table:update and invalid (plus sync) for a malformed one', async () => {
    const { client, events, socket } = setup();
    socket().connected = true;
    socket().fire('connect');
    await client.quickSeat();
    socket().emitted.length = 0;
    socket().fire('table:update', validUpdate);
    expect(events.some((e) => e.type === 'update')).toBe(true);
    socket().fire('table:update', { tableId: 't1' });
    expect(events.some((e) => e.type === 'invalid')).toBe(true);
    expect(socket().emitted).toEqual([{ event: 'table:sync', payload: { tableId: 't1' } }]);
  });

  it('after reconnecting it sends table:sync', async () => {
    const { client, events, socket } = setup();
    socket().connected = true;
    socket().fire('connect');
    await client.quickSeat();
    socket().fire('disconnect', 'transport close');
    expect(statuses(events).at(-1)).toBe('reconnecting');
    socket().emitted.length = 0;
    socket().fire('connect');
    expect(statuses(events).at(-1)).toBe('connected');
    expect(socket().emitted).toEqual([{ event: 'table:sync', payload: { tableId: 't1' } }]);
  });

  it('io server disconnect reconnects manually (disconnectAction manual)', () => {
    const { socket } = setup();
    socket().fire('disconnect', 'io server disconnect');
    expect(socket().connect).toHaveBeenCalledTimes(1);
    socket().fire('disconnect', 'transport close');
    expect(socket().connect).toHaveBeenCalledTimes(1);
  });

  it('UNAUTHORIZED refreshes the token once, then reports unauthorized', () => {
    const { events, socket } = setup();
    socket().fire('connect_error', new Error('UNAUTHORIZED'));
    expect(socket().connect).toHaveBeenCalledTimes(1);
    expect(statuses(events)).not.toContain('unauthorized');
    socket().fire('connect_error', new Error('UNAUTHORIZED'));
    expect(socket().connect).toHaveBeenCalledTimes(1);
    expect(statuses(events).at(-1)).toBe('unauthorized');
  });

  it('act sends tableId and seq', async () => {
    const { client, socket } = setup();
    socket().connected = true;
    socket().fire('connect');
    await client.quickSeat(500);
    await client.act(7, { type: 'call' });
    expect(socket().emitted.at(-1)).toEqual({
      event: 'table:act',
      payload: { tableId: 't1', seq: 7, action: { type: 'call' } },
    });
  });

  it('after leave and a new quickSeat, a server disconnect reconnects; sync after leave sends nothing', async () => {
    const { client, socket } = setup();
    socket().connected = true;
    socket().fire('connect');
    await client.quickSeat();
    await client.leave();
    socket().emitted.length = 0;
    client.sync();
    expect(socket().emitted).toEqual([]);
    await client.quickSeat();
    socket().fire('disconnect', 'io server disconnect');
    expect(socket().connect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['table:closed', { tableId: 't1', reason: 'nope' }],
    ['table:degraded', { tableId: 't1', degraded: 'x' }],
  ])('malformed %s is reported invalid and followed by sync', async (event, payload) => {
    const { client, events, socket } = setup();
    socket().connected = true;
    socket().fire('connect');
    await client.quickSeat();
    socket().emitted.length = 0;
    socket().fire(event, payload);
    expect(events.some((e) => e.type === 'invalid')).toBe(true);
    expect(socket().emitted).toEqual([{ event: 'table:sync', payload: { tableId: 't1' } }]);
  });
});
