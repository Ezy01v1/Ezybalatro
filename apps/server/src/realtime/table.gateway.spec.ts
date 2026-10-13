import type { Server, Socket } from 'socket.io';
import { AccountDeletedError, type AccountPort } from '../accounts/account-port';
import type { QuickSeatResult, TableDirector } from '../tables/table-director';
import type { TableRuntime } from '../tables/table-runtime';
import type { TableSettings } from '../tables/table-settings';
import type { Identity, IdentityPort } from './identity';
import { TableGateway } from './table.gateway';

const ANA: Identity = { userId: '00000000-0000-4000-8000-00000000000a', isGuest: false };

function fakeSocket(id: string, identity: Identity): Socket {
  return {
    id,
    data: { identity },
    emit: jest.fn(),
    disconnect: jest.fn(),
    conn: { close: jest.fn() },
  } as unknown as Socket;
}

/** A director whose quick seat stays in flight until `settle` is called. */
function setup() {
  const table = {
    id: 't1',
    disconnected: jest.fn(),
    reconnected: jest.fn(),
    subscribe: jest.fn(() => () => {}),
    snapshot: jest.fn(),
    seatOf: jest.fn(() => 0),
  };
  let seatedAt: TableRuntime | null = null;
  let settle: (result: QuickSeatResult) => void = () => {};
  const director = {
    quickSeat: jest.fn(
      () =>
        new Promise<QuickSeatResult>((resolve) => {
          settle = (result) => {
            if (result.ok) seatedAt = table as unknown as TableRuntime;
            resolve(result);
          };
        }),
    ),
    tableOf: jest.fn(() => seatedAt),
    get: jest.fn(() => seatedAt),
  };
  const identity: IdentityPort = { authenticate: async () => ANA };
  const accounts: AccountPort = {
    ensureAccount: jest.fn(async () => ANA.userId),
    isDeleted: jest.fn(async () => false),
    applyDailyRefill: jest.fn(async () => 0),
  };
  const gateway = new TableGateway(director as unknown as TableDirector, identity, accounts, {
    socketRateLimitPerSec: 10,
  } as TableSettings);
  return { gateway, accounts, table, settle: (r: QuickSeatResult) => settle(r) };
}

describe('TableGateway', () => {
  /** Runs the registered handshake middleware against a fake socket. */
  function handshake(gateway: TableGateway, socket: Socket): Promise<Error | undefined> {
    let middleware!: (s: Socket, next: (e?: Error) => void) => void;
    gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as unknown as Server);
    return new Promise((resolve) => middleware(socket, resolve));
  }

  it('creates the account and applies the daily refill before accepting the connection', async () => {
    const { gateway, accounts } = setup();
    const socket = { data: {}, handshake: { auth: {} } } as unknown as Socket;
    await expect(handshake(gateway, socket)).resolves.toBeUndefined();
    expect(accounts.ensureAccount).toHaveBeenCalledWith({ userId: ANA.userId, isGuest: false });
    expect(accounts.applyDailyRefill).toHaveBeenCalledWith(ANA.userId, expect.any(Date));
    expect((socket.data as { identity?: Identity }).identity).toEqual(ANA);
  });

  it('rejects the connection with INTERNAL when the account setup fails', async () => {
    const { gateway, accounts } = setup();
    jest
      .spyOn((gateway as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => {});
    (accounts.ensureAccount as jest.Mock).mockRejectedValue(new Error('db down: secret-host'));
    const socket = { data: {}, handshake: { auth: {} } } as unknown as Socket;
    const error = (await handshake(gateway, socket)) as Error & { data?: { code: string } };
    expect(error.message).toBe('INTERNAL');
    expect(error.data?.code).toBe('INTERNAL');
    expect(JSON.stringify(error.data)).not.toContain('secret-host');
    expect((socket.data as { identity?: Identity }).identity).toBeUndefined();
  });

  it('rejects with UNAUTHORIZED when the profile is deleted during account setup', async () => {
    const { gateway, accounts } = setup();
    (accounts.ensureAccount as jest.Mock).mockRejectedValue(new AccountDeletedError());
    const socket = { data: {}, handshake: { auth: {} } } as unknown as Socket;
    const error = (await handshake(gateway, socket)) as Error;
    expect(error.message).toBe('UNAUTHORIZED');
    expect(accounts.applyDailyRefill).not.toHaveBeenCalled();
    expect((socket.data as { identity?: Identity }).identity).toBeUndefined();
  });

  it('starts the disconnect grace once a quick seat in flight at disconnect settles', async () => {
    const { gateway, table, settle } = setup();
    const socket = fakeSocket('s1', ANA);
    gateway.handleConnection(socket);
    const ack = gateway.quickSeat(socket, {});

    gateway.handleDisconnect(socket);
    expect(table.disconnected).not.toHaveBeenCalled(); // not seated yet

    settle({ ok: true, tableId: 't1', seat: 0 });
    await expect(ack).resolves.toEqual({ ok: true, tableId: 't1', seat: 0 });
    expect(table.disconnected).toHaveBeenCalledWith(ANA.userId);
  });

  it('forwards degraded messages as table:degraded', async () => {
    const { gateway, table, settle } = setup();
    const socket = fakeSocket('s1', ANA);
    gateway.handleConnection(socket);
    const ack = gateway.quickSeat(socket, {});
    settle({ ok: true, tableId: 't1', seat: 0 });
    await ack;
    const calls = table.subscribe.mock.calls as unknown as [string, (m: unknown) => void][];
    const listener = calls.at(-1)![1];
    listener({ type: 'degraded', degraded: { tableId: 't1', degraded: true } });
    expect(socket.emit).toHaveBeenCalledWith('table:degraded', { tableId: 't1', degraded: true });
  });

  it('does not start the grace when the user came back before the quick seat settled', async () => {
    const { gateway, table, settle } = setup();
    const first = fakeSocket('s1', ANA);
    gateway.handleConnection(first);
    const ack = gateway.quickSeat(first, {});
    gateway.handleDisconnect(first);
    gateway.handleConnection(fakeSocket('s2', ANA));

    settle({ ok: true, tableId: 't1', seat: 0 });
    await ack;
    expect(table.disconnected).not.toHaveBeenCalled();
  });

  it('handleConnection and handleDisconnect never throw: they log the error', async () => {
    const { gateway, table, settle } = setup();
    const logError = jest
      .spyOn((gateway as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => {});
    const socket = fakeSocket('s1', ANA);
    gateway.handleConnection(socket);
    const ack = gateway.quickSeat(socket, {});
    settle({ ok: true, tableId: 't1', seat: 0 });
    await ack;

    table.snapshot.mockImplementation(() => {
      throw new Error('snapshot exploded');
    });
    expect(() => gateway.handleConnection(fakeSocket('s2', ANA))).not.toThrow();
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('snapshot exploded'),
      expect.any(String),
    );

    logError.mockClear();
    table.disconnected.mockImplementation(() => {
      throw new Error('disconnected exploded');
    });
    const current = fakeSocket('s3', ANA);
    gateway.handleConnection(current);
    logError.mockClear();
    expect(() => gateway.handleDisconnect(current)).not.toThrow();
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('disconnected exploded'),
      expect.any(String),
    );
  });

  it('a connection registered after its account was deleted is disconnected with UNAUTHORIZED', async () => {
    const { gateway, accounts } = setup();
    (accounts.isDeleted as jest.Mock).mockResolvedValue(true);
    const socket = fakeSocket('s1', ANA);
    gateway.handleConnection(socket);
    await new Promise((r) => setImmediate(r));
    expect(accounts.isDeleted).toHaveBeenCalledWith(ANA.userId);
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ type: 'error', code: 'UNAUTHORIZED' }));
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('a live account keeps its connection', async () => {
    const { gateway } = setup();
    const socket = fakeSocket('s1', ANA);
    gateway.handleConnection(socket);
    await new Promise((r) => setImmediate(r));
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('a replaced connection gets session:replaced and dropping it starts no grace', () => {
    const { gateway, table } = setup();
    const first = fakeSocket('s1', ANA);
    const second = fakeSocket('s2', ANA);
    gateway.handleConnection(first);
    gateway.handleConnection(second);

    expect(first.emit).toHaveBeenCalledWith(
      'session:replaced',
      expect.objectContaining({ type: 'error', code: 'SESSION_REPLACED' }),
    );
    expect(first.disconnect).toHaveBeenCalled();
    gateway.handleDisconnect(first);
    expect(table.disconnected).not.toHaveBeenCalled();
  });
});
