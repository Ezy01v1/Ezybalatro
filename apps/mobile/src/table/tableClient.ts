import { io as defaultIo } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  connectErrorAction,
  disconnectAction,
  isTableClosed,
  isTableDegraded,
  isTableUpdate,
  type Ack,
  type PlayerAction,
  type SocketError,
  type TableClosed,
  type TableDegraded,
  type TableUpdate,
} from '@naipes/shared';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'unauthorized';

export type ClientEvent =
  | { type: 'status'; status: ConnectionStatus }
  | { type: 'update'; update: TableUpdate }
  | { type: 'closed'; closed: TableClosed }
  | { type: 'degraded'; degraded: TableDegraded }
  | { type: 'replaced' }
  | { type: 'error'; error: SocketError }
  | { type: 'invalid' };

export interface TableClient {
  connect(): void;
  quickSeat(buyIn?: number): Promise<Ack<{ tableId: string; seat: number }>>;
  act(seq: number, action: PlayerAction): Promise<Ack>;
  sitOut(): Promise<Ack>;
  sitIn(): Promise<Ack>;
  leave(): Promise<Ack<{ cashOut: number | null }>>;
  /** Asks the server for the current state of the table we are sitting at. */
  sync(): void;
  disconnect(): void;
  on(listener: (event: ClientEvent) => void): () => void;
}

export interface TableClientDeps {
  url: string;
  getToken: () => Promise<string | null>;
  io?: typeof defaultIo;
}

const ACK_TIMEOUT_MS = 5000;

const failure = (code: SocketError['code'], message: string): Ack<never> => ({
  ok: false,
  error: { type: 'error', code, message },
});

export function createTableClient(deps: TableClientDeps): TableClient {
  const listeners = new Set<(event: ClientEvent) => void>();
  const emit = (event: ClientEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };

  let socket: ReturnType<typeof defaultIo> | null = null;
  let tableId: string | null = null;
  let everConnected = false;
  let authRetried = false;
  let leaving = false;
  let done = false;

  function request<T extends object = object>(event: string, payload: object): Promise<Ack<T>> {
    const current = socket;
    if (!current || !current.connected) {
      return Promise.resolve(failure('INTERNAL', 'Not connected'));
    }
    return new Promise((resolve) => {
      current
        .timeout(ACK_TIMEOUT_MS)
        .emit(event, payload, (timedOut: Error | null, ack: Ack<T>) => {
          resolve(timedOut ? failure('INTERNAL', 'The server did not answer in time') : ack);
        });
    });
  }

  function requestForTable<T extends object = object>(
    event: string,
    extra: object = {},
  ): Promise<Ack<T>> {
    if (tableId === null) return Promise.resolve(failure('NOT_AT_TABLE', 'Not seated at a table'));
    return request<T>(event, { tableId, ...extra });
  }

  function sync(): void {
    if (socket?.connected && tableId !== null) socket.emit(SOCKET_EVENTS.sync, { tableId });
  }

  function wire(s: NonNullable<typeof socket>): void {
    s.on('connect', () => {
      everConnected = true;
      authRetried = false;
      emit({ type: 'status', status: 'connected' });
      // After a reconnect the server may have moved on: ask for the current state.
      sync();
    });

    s.on('connect_error', (error: Error) => {
      if (error.message === 'UNAUTHORIZED') {
        // Middleware rejections are not retried by socket.io: try once more (auth asks for a fresh token).
        if (!authRetried) {
          authRetried = true;
          emit({ type: 'status', status: 'connecting' });
          s.connect();
          return;
        }
        emit({ type: 'status', status: 'unauthorized' });
        return;
      }
      const action = connectErrorAction({ everConnected, message: error.message });
      emit({ type: 'status', status: action === 'exit' ? 'offline' : 'reconnecting' });
    });

    s.on('disconnect', (reason: string) => {
      const action = disconnectAction({ reason, leaving, done });
      if (action === 'none') return;
      emit({ type: 'status', status: 'reconnecting' });
      // socket.io does not retry after a server-initiated disconnect on its own.
      if (action === 'manual') s.connect();
    });

    s.on(SOCKET_EVENTS.tableUpdate, (payload: unknown) => {
      if (!isTableUpdate(payload)) {
        emit({ type: 'invalid' });
        sync();
        return;
      }
      tableId = payload.tableId;
      emit({ type: 'update', update: payload });
    });

    s.on(SOCKET_EVENTS.tableClosed, (payload: unknown) => {
      if (!isTableClosed(payload)) {
        emit({ type: 'invalid' });
        return;
      }
      if (payload.tableId === tableId) tableId = null;
      emit({ type: 'closed', closed: payload });
    });

    s.on(SOCKET_EVENTS.tableDegraded, (payload: unknown) => {
      if (!isTableDegraded(payload)) {
        emit({ type: 'invalid' });
        return;
      }
      emit({ type: 'degraded', degraded: payload });
    });

    s.on(SOCKET_EVENTS.sessionReplaced, () => {
      done = true;
      emit({ type: 'replaced' });
    });

    s.on(SOCKET_EVENTS.error, (error: SocketError) => emit({ type: 'error', error }));
  }

  return {
    connect() {
      if (socket) return;
      done = false;
      leaving = false;
      emit({ type: 'status', status: 'connecting' });
      const connectIo = deps.io ?? defaultIo;
      socket = connectIo(deps.url, {
        transports: ['websocket'],
        reconnection: true,
        auth: (cb: (data: object) => void) => {
          void deps
            .getToken()
            .catch(() => null)
            .then((token) => cb({ token }));
        },
      });
      wire(socket);
    },

    async quickSeat(buyIn) {
      const ack = await request<{ tableId: string; seat: number }>(
        SOCKET_EVENTS.quickSeat,
        buyIn === undefined ? {} : { buyIn },
      );
      if (ack.ok) tableId = ack.tableId;
      return ack;
    },

    act: (seq, action) => requestForTable(SOCKET_EVENTS.act, { seq, action }),
    sitOut: () => requestForTable(SOCKET_EVENTS.sitOut),
    sitIn: () => requestForTable(SOCKET_EVENTS.sitIn),

    async leave() {
      const ack = await requestForTable<{ cashOut: number | null }>(SOCKET_EVENTS.leave);
      if (ack.ok) leaving = true;
      return ack;
    },

    sync,

    disconnect() {
      done = true;
      socket?.disconnect();
      socket = null;
      tableId = null;
    },

    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
