import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import {
  actRequestSchema,
  quickSeatRequestSchema,
  sitInRequestSchema,
  SOCKET_EVENTS,
  tableRequestSchema,
  type Ack,
  type SocketError,
  type TableUpdate,
} from '@naipes/shared';
import type { Server, Socket } from 'socket.io';
import { ACCOUNTS, type AccountPort } from '../accounts/account-port';
import { socketError } from '../tables/errors';
import { TableDirector } from '../tables/table-director';
import type { TableMessage, TableRuntime } from '../tables/table-runtime';
import { TABLE_SETTINGS, type TableSettings } from '../tables/table-settings';
import { IDENTITY, type Identity, type IdentityPort } from './identity';
import { SocketRateLimiter } from './rate-limiter';

interface SocketData {
  identity?: Identity;
}

type Failure = { ok: false; error: SocketError };

const CLOSE_CONNECTIONS_TIMEOUT_MS = 2000;

const fail = (error: SocketError): Failure => ({ ok: false, error });
const invalidMessage = () => fail(socketError('INVALID_MESSAGE', 'Invalid message'));
const notAtTable = () => fail(socketError('NOT_AT_TABLE', 'You are not seated at this table'));

function identityOf(socket: Socket): Identity | null {
  return (socket.data as SocketData).identity ?? null;
}

/**
 * Socket.IO adapter of the tables (spec §3.5, §4): authenticates the handshake, validates every
 * message with the shared schemas and answers by ack, and sends each user their own `table:update`.
 *
 * The acting player is always the socket's authenticated user, never something from the payload.
 * Payloads, views, cards and tokens are never logged.
 */
@WebSocketGateway()
export class TableGateway
  implements OnGatewayInit<Server>, OnGatewayConnection<Socket>, OnGatewayDisconnect<Socket>
{
  private readonly logger = new Logger('TableGateway');
  /** userId → the user's current socket (one per user: a new connection replaces the old one). */
  private readonly sockets = new Map<string, Socket>();
  private readonly limiter: SocketRateLimiter;

  constructor(
    private readonly director: TableDirector,
    @Inject(IDENTITY) private readonly identity: IdentityPort,
    @Inject(ACCOUNTS) private readonly accounts: AccountPort,
    @Inject(TABLE_SETTINGS) settings: TableSettings,
  ) {
    this.limiter = new SocketRateLimiter(settings.socketRateLimitPerSec, () => Date.now());
  }

  // ------------------------------------------------------------ connection lifecycle

  afterInit(server: Server): void {
    server.use((socket, next) => {
      this.identity.authenticate(socket.handshake.auth).then(
        (identity) => {
          if (!identity) {
            next(new Error('UNAUTHORIZED'));
            return;
          }
          // The account (and its daily refill) is ready before the connection accepts commands.
          this.prepareAccount(identity).then(
            () => {
              (socket.data as SocketData).identity = identity;
              next();
            },
            (error: unknown) => {
              this.logError('account setup failed', error);
              const rejection = new Error('INTERNAL') as Error & { data?: SocketError };
              rejection.data = socketError('INTERNAL', 'Internal error');
              next(rejection);
            },
          );
        },
        (error: unknown) => {
          this.logError('authentication failed', error);
          next(new Error('UNAUTHORIZED'));
        },
      );
    });
  }

  private async prepareAccount(identity: Identity): Promise<void> {
    await this.accounts.ensureAccount(identity.userId);
    await this.accounts.applyDailyRefill(identity.userId, new Date());
  }

  /** Nest calls this from an RxJS subscribe: a throw would become an uncaught exception. */
  handleConnection(socket: Socket): void {
    try {
      this.onConnection(socket);
    } catch (error) {
      this.logError('connection handler failed', error);
    }
  }

  /** Same as `handleConnection`: never throws. */
  handleDisconnect(socket: Socket): void {
    try {
      this.onDisconnect(socket);
    } catch (error) {
      this.logError('disconnect handler failed', error);
    }
  }

  private onConnection(socket: Socket): void {
    const identity = identityOf(socket);
    if (!identity) {
      socket.disconnect();
      return;
    }
    const { userId } = identity;
    const previous = this.sockets.get(userId);
    // The new socket is current before the old one drops: being replaced is not a disconnection.
    this.sockets.set(userId, socket);
    if (previous && previous !== socket) {
      previous.emit(
        SOCKET_EVENTS.sessionReplaced,
        socketError('SESSION_REPLACED', 'Another connection replaced this one'),
      );
      // The disconnect packet goes first: the client gets "io server disconnect" and does not
      // reconnect on its own. Then the transport closes once flushed, whatever the client does.
      previous.disconnect();
      previous.conn.close();
    }
    const table = this.director.tableOf(userId);
    if (table) {
      table.reconnected(userId);
      socket.emit(SOCKET_EVENTS.tableUpdate, table.snapshot(userId));
    }
  }

  private onDisconnect(socket: Socket): void {
    this.limiter.forget(socket.id);
    const identity = identityOf(socket);
    if (!identity) return;
    const { userId } = identity;
    if (this.sockets.get(userId) !== socket) return; // replaced by a newer connection
    this.sockets.delete(userId);
    // A quick seat still in flight has not seated the user yet: its handler starts the grace.
    this.director.tableOf(userId)?.disconnected(userId);
  }

  // ------------------------------------------------------------ messages

  @SubscribeMessage(SOCKET_EVENTS.quickSeat)
  quickSeat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<Ack<{ tableId: string; seat: number }>> {
    return this.handle(socket, async (userId) => {
      // `table:quickSeat` may come without a payload.
      const request = quickSeatRequestSchema.safeParse(body ?? {});
      if (!request.success) return invalidMessage();
      const result = await this.director.quickSeat(userId, request.data.buyIn);
      const table = result.ok ? this.director.get(result.tableId) : null;
      if (table) {
        // Messages go to whatever socket is current when they are sent: reconnects need no re-subscribe.
        table.subscribe(userId, (message) => this.deliver(userId, message));
        // The connection dropped while the seat was in flight (`handleDisconnect` found no table):
        // start the grace now, unless the user is already back.
        if (!this.sockets.has(userId)) table.disconnected(userId);
      }
      return result;
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.act)
  act(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<Ack> {
    return this.handle(socket, (userId) => {
      const request = actRequestSchema.safeParse(body);
      if (!request.success) return invalidMessage();
      const table = this.tableFor(userId, request.data.tableId);
      if (!table) return notAtTable();
      return table.act(userId, request.data.seq, request.data.action);
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.sitOut)
  sitOut(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<Ack> {
    return this.handle(socket, (userId) => {
      const request = tableRequestSchema.safeParse(body);
      if (!request.success) return invalidMessage();
      const table = this.tableFor(userId, request.data.tableId);
      if (!table) return notAtTable();
      return table.sitOut(userId);
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.sitIn)
  sitIn(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<Ack> {
    return this.handle(socket, (userId) => {
      const request = sitInRequestSchema.safeParse(body);
      if (!request.success) return invalidMessage();
      const table = this.tableFor(userId, request.data.tableId);
      if (!table) return notAtTable();
      return table.sitIn(userId, request.data.postBlindsToEnter);
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.leave)
  leave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<Ack<{ cashOut: number | null }>> {
    return this.handle(socket, (userId) => {
      const request = tableRequestSchema.safeParse(body);
      if (!request.success) return invalidMessage();
      const table = this.tableFor(userId, request.data.tableId);
      if (!table) return notAtTable();
      return table.leave(userId);
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.sync)
  sync(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<Ack<{ update: TableUpdate }>> {
    return this.handle(socket, (userId) => {
      const request = tableRequestSchema.safeParse(body);
      if (!request.success) return invalidMessage();
      const table = this.tableFor(userId, request.data.tableId);
      if (!table) return notAtTable();
      return { ok: true, update: table.snapshot(userId) };
    });
  }

  /**
   * Shutdown: closes every connection once what was sent to it is flushed, waiting at most
   * `timeoutMs`. Closing the Socket.IO server right away would discard the last `table:update` and
   * `table:closed` still buffered. Clients see a "transport close" and reconnect on their own.
   */
  async closeConnections(timeoutMs = CLOSE_CONNECTIONS_TIMEOUT_MS): Promise<void> {
    const closed = [...this.sockets.values()].map(
      (socket) =>
        new Promise<void>((resolve) => {
          const conn = socket.conn;
          if (conn.readyState === 'closed') {
            resolve();
            return;
          }
          conn.once('close', () => resolve());
          conn.close(); // waits for the write buffer to drain
        }),
    );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref();
    });
    await Promise.race([Promise.all(closed), timeout]);
    clearTimeout(timer);
  }

  // ------------------------------------------------------------ internals

  /** Rate limit, then the handler with the socket's user; a throwing handler answers `INTERNAL`. */
  private async handle<T extends object>(
    socket: Socket,
    run: (userId: string) => Ack<T> | Promise<Ack<T>>,
  ): Promise<Ack<T>> {
    if (!this.limiter.allow(socket.id)) {
      return fail(socketError('RATE_LIMITED', 'Too many messages; slow down'));
    }
    const identity = identityOf(socket);
    if (!identity) return fail(socketError('UNAUTHORIZED', 'Not authenticated'));
    try {
      return await run(identity.userId);
    } catch (error) {
      this.logError('message handler failed', error);
      return fail(socketError('INTERNAL', 'Internal error'));
    }
  }

  /** The table, if it exists and the user has a seat there (`leaving` included). */
  private tableFor(userId: string, tableId: string): TableRuntime | null {
    const table = this.director.get(tableId);
    return table && table.seatOf(userId) !== null ? table : null;
  }

  /** Sends a table message to the user's current socket; with none, it is dropped (reconnect resyncs). */
  private deliver(userId: string, message: TableMessage): void {
    const socket = this.sockets.get(userId);
    if (!socket) return;
    switch (message.type) {
      case 'update':
        socket.emit(SOCKET_EVENTS.tableUpdate, message.update);
        break;
      case 'closed':
        socket.emit(SOCKET_EVENTS.tableClosed, message.closed);
        break;
      case 'degraded':
        socket.emit(SOCKET_EVENTS.tableDegraded, message.degraded);
        break;
    }
  }

  /** Logs the error's name, message and stack only. */
  private logError(context: string, error: unknown): void {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'non-Error thrown';
    this.logger.error(`${context}: ${detail}`, error instanceof Error ? error.stack : undefined);
  }
}
