// Must be the first import: it sets the fast table timings before `AppModule` validates the env.
import './table-env';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SOCKET_EVENTS, type Ack, type PlayerAction, type TableUpdate } from '@naipes/shared';
import { io, type Socket } from 'socket.io-client';
import type { TestDatabase } from '../src/db/testing/test-database';
import { setupApp } from '../src/setup-app';
import { loadAppModule, startE2eDatabase } from './test-database-env';

/** Everything a client got: server events and the acks of its own messages (`ack:<event>`). */
interface Received {
  event: string;
  payload: unknown;
}

// ------------------------------------------------------------ waiting on received messages

interface Waiter {
  check: () => boolean;
  resolve: () => void;
}

const waiters = new Set<Waiter>();

function notify(): void {
  for (const waiter of [...waiters]) {
    if (waiter.check()) {
      waiters.delete(waiter);
      waiter.resolve();
    }
  }
}

/** Resolves as soon as `check` holds; re-checked on every message any client receives. */
function until(check: () => boolean, timeoutMs: number, label: string): Promise<void> {
  if (check()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(waiter);
      reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`));
    }, timeoutMs);
    const waiter: Waiter = {
      check,
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
    };
    waiters.add(waiter);
  });
}

// ------------------------------------------------------------ test client

const clients: Player[] = [];

/** A Socket.IO client that, with `autoplay`, checks or calls whenever `view.legal` is not null. */
class Player {
  readonly userId: string;
  readonly socket: Socket;
  readonly received: Received[] = [];
  readonly updates: TableUpdate[] = [];
  /** Unexpected ack error codes of autoplay actions. */
  readonly errors: string[] = [];
  disconnectReason: string | null = null;
  private actedSeq = -1;

  constructor(
    url: string,
    name: string,
    private readonly options: { autoplay?: boolean; auth?: unknown } = {},
  ) {
    this.userId = `dev:${name}`;
    this.socket = io(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: (options.auth ?? { token: this.userId }) as Record<string, unknown>,
    });
    this.socket.onAny((event: string, payload: unknown) => {
      this.received.push({ event, payload });
      if (event === SOCKET_EVENTS.tableUpdate) {
        this.updates.push(payload as TableUpdate);
        this.play();
      }
      notify();
    });
    this.socket.on('disconnect', (reason) => {
      this.disconnectReason = reason;
      notify();
    });
    clients.push(this);
  }

  connected(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.connected) {
        resolve();
        return;
      }
      this.socket.once('connect', () => resolve());
      this.socket.once('connect_error', reject);
    });
  }

  async emit<T extends object = object>(event: string, payload?: unknown): Promise<Ack<T>> {
    const socket = this.socket.timeout(5000);
    const reply = (await (payload === undefined
      ? socket.emitWithAck(event)
      : socket.emitWithAck(event, payload))) as Ack<T>;
    this.received.push({ event: `ack:${event}`, payload: reply });
    notify();
    return reply;
  }

  latest(): TableUpdate | undefined {
    return this.updates.at(-1);
  }

  private play(): void {
    if (this.options.autoplay === false) return;
    const update = this.latest();
    const legal = update?.view.legal;
    if (!update || !legal || update.seq <= this.actedSeq) return;
    this.actedSeq = update.seq;
    const action: PlayerAction = legal.canCheck ? { type: 'check' } : { type: 'call' };
    void this.act(update, action);
  }

  private async act(update: TableUpdate, action: PlayerAction): Promise<void> {
    let reply: Ack;
    try {
      reply = await this.emit(SOCKET_EVENTS.act, {
        tableId: update.tableId,
        seq: update.seq,
        action,
      });
    } catch {
      return; // disconnected meanwhile
    }
    if (reply.ok || reply.error.code === 'STALE_SEQ') return;
    if (reply.error.code === 'RATE_LIMITED') {
      setTimeout(() => {
        if (this.latest() !== update) return;
        this.actedSeq = -1;
        this.play();
      }, 200);
      return;
    }
    this.errors.push(reply.error.code);
  }
}

// ------------------------------------------------------------ hand helpers

function ownCards(update: TableUpdate, userId: string): string[] | null {
  const cards = update.view.hand?.players.find((p) => p.playerId === userId)?.holeCards;
  return cards ? cards.map((c) => c.id) : null;
}

/** handNumber → own hole card ids, for every hand the player was dealt into. */
function dealtHands(player: Player): Map<number, string[]> {
  const hands = new Map<number, string[]>();
  for (const update of player.updates) {
    const hand = update.view.hand;
    const cards = ownCards(update, player.userId);
    if (hand && cards) hands.set(hand.handNumber, cards);
  }
  return hands;
}

function settledHands(player: Player): Set<number> {
  const hands = new Set<number>();
  for (const update of player.updates) {
    for (const e of update.events) if (e.type === 'handSettled') hands.add(e.handNumber);
  }
  return hands;
}

/** A hand both players were dealt into and both saw settle, or null. */
function commonSettledHand(a: Player, b: Player): number | null {
  const dealtB = dealtHands(b);
  const settledA = settledHands(a);
  const settledB = settledHands(b);
  for (const hand of dealtHands(a).keys()) {
    if (dealtB.has(hand) && settledA.has(hand) && settledB.has(hand)) return hand;
  }
  return null;
}

/**
 * What the player received during `hand`, from its first update of that hand up to (not including)
 * the update carrying its `showdown` event, or the first update of a later hand.
 */
function receivedBeforeShowdown(received: readonly Received[], hand: number): Received[] {
  const handOf = (r: Received): number | null =>
    r.event === SOCKET_EVENTS.tableUpdate
      ? ((r.payload as TableUpdate).view.hand?.handNumber ?? null)
      : null;
  const start = received.findIndex((r) => handOf(r) === hand);
  if (start === -1) return [];
  let end = received.length;
  for (let i = start; i < received.length; i++) {
    const r = received[i]!;
    const h = handOf(r);
    const showdown =
      r.event === SOCKET_EVENTS.tableUpdate &&
      (r.payload as TableUpdate).events.some((e) => e.type === 'showdown');
    if ((h !== null && h > hand) || showdown) {
      end = i;
      break;
    }
  }
  return received.slice(start, end);
}

const BOTH_DEALT_TIMEOUT_MS = 20_000;

// ------------------------------------------------------------ suite

describe('Table gateway (e2e)', () => {
  let app: INestApplication | null = null;
  let url: string;
  let db: TestDatabase;

  async function closeAll(): Promise<void> {
    for (const client of clients.splice(0)) client.socket.disconnect();
    await app?.close();
    app = null;
  }

  async function seated(
    name: string,
    options?: { autoplay?: boolean },
  ): Promise<{ player: Player; tableId: string; seat: number }> {
    const player = new Player(url, name, options);
    await player.connected();
    const ack = await player.emit<{ tableId: string; seat: number }>(SOCKET_EVENTS.quickSeat, {});
    if (!ack.ok) throw new Error(`quickSeat failed: ${ack.error.code}`);
    return { player, tableId: ack.tableId, seat: ack.seat };
  }

  beforeAll(async () => {
    db = await startE2eDatabase();
  });

  // A fresh app and an empty database per test: tables, wallets and quick-seat choices never leak.
  beforeEach(async () => {
    await db.reset();
    const moduleRef = await Test.createTestingModule({ imports: [await loadAppModule()] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterEach(closeAll);
  afterAll(async () => {
    await closeAll();
    await db?.stop();
  });

  it('rejects a handshake without a valid token', async () => {
    for (const auth of [{}, { token: 'dev:x' }, { token: 'ana' }, { token: 42 }]) {
      const client = new Player(url, 'ignored', { auth });
      await expect(client.connected()).rejects.toMatchObject({ message: 'UNAUTHORIZED' });
    }
  });

  it('two humans and bots play a full hand over Socket.IO', async () => {
    const a = await seated('ana');
    const b = await seated('beto');
    expect(b.tableId).toBe(a.tableId);

    await until(
      () => commonSettledHand(a.player, b.player) !== null,
      BOTH_DEALT_TIMEOUT_MS,
      'a hand dealt to both humans to settle',
    );
    const hand = commonSettledHand(a.player, b.player)!;
    for (const { player } of [a, b]) {
      expect(player.errors).toEqual([]);
      expect(player.updates.every((u) => u.tableId === a.tableId)).toBe(true);
      const settled = player.updates
        .flatMap((u) => u.events)
        .find((e) => e.type === 'handSettled' && e.handNumber === hand);
      expect(settled).toBeDefined();
    }
    const seats = a.player.latest()!.view.seats;
    expect(seats.some((s) => s?.playerId.startsWith('bot:'))).toBe(true);
  }, 25_000);

  it('A never receives B hole cards before the showdown', async () => {
    const a = await seated('ana');
    const b = await seated('beto');
    expect(b.tableId).toBe(a.tableId);

    await until(
      () => commonSettledHand(a.player, b.player) !== null,
      BOTH_DEALT_TIMEOUT_MS,
      'a hand dealt to both humans to settle',
    );
    const hand = commonSettledHand(a.player, b.player)!;
    const bCards = dealtHands(b.player).get(hand)!;
    expect(bCards).toHaveLength(2);
    // Control: the search does find B's cards where they belong.
    expect(JSON.stringify(b.player.received)).toContain(`"${bCards[0]}"`);

    const window = receivedBeforeShowdown(a.player.received, hand);
    expect(window.length).toBeGreaterThan(0);
    const leaks: string[] = [];
    for (const { event, payload } of window) {
      const json = JSON.stringify(payload);
      // Card ids are unique per deck: any appearance in this hand is a leak.
      for (const id of bCards) if (json.includes(`"${id}"`)) leaks.push(`${event}: ${id}`);
    }
    expect(leaks).toEqual([]);
  }, 25_000);

  it('reconnecting mid-hand delivers a snapshot with the own hole cards', async () => {
    const a = await seated('ana', { autoplay: false });
    await until(
      () => a.player.latest()?.view.legal != null,
      BOTH_DEALT_TIMEOUT_MS,
      'ana to be on turn',
    );
    const before = a.player.latest()!;
    const cards = ownCards(before, a.player.userId);
    expect(cards).toHaveLength(2);

    a.player.socket.disconnect();
    const again = new Player(url, 'ana', { autoplay: false });
    await again.connected();
    await until(() => again.updates.length > 0, 5_000, 'the snapshot after reconnecting');

    const snapshot = again.updates[0]!;
    expect(snapshot.tableId).toBe(a.tableId);
    expect(snapshot.events).toEqual([]);
    expect(snapshot.view.mySeat).toBe(a.seat);
    expect(snapshot.view.hand?.handNumber).toBe(before.view.hand!.handNumber);
    expect(ownCards(snapshot, again.userId)).toEqual(cards);
    expect(snapshot.view.legal).not.toBeNull();

    const legal = snapshot.view.legal!;
    const ack = await again.emit(SOCKET_EVENTS.act, {
      tableId: a.tableId,
      seq: snapshot.seq,
      action: legal.canCheck ? { type: 'check' } : { type: 'call' },
    });
    expect(ack).toEqual({ ok: true });
  }, 25_000);

  it('a second connection replaces the first with session:replaced', async () => {
    const a = await seated('ana');
    const second = new Player(url, 'ana');
    await second.connected();

    await until(() => a.player.disconnectReason !== null, 5_000, 'the first connection to drop');
    const replaced = a.player.received.find((r) => r.event === SOCKET_EVENTS.sessionReplaced);
    expect(replaced?.payload).toMatchObject({ type: 'error', code: 'SESSION_REPLACED' });
    // A server-side disconnect: the client must not reconnect on its own.
    expect(a.player.disconnectReason).toBe('io server disconnect');

    await until(() => second.updates.length > 0, 5_000, 'the snapshot on the new connection');
    expect(second.updates[0]!.tableId).toBe(a.tableId);
    const sync = await second.emit<{ update: TableUpdate }>(SOCKET_EVENTS.sync, {
      tableId: a.tableId,
    });
    expect(sync).toMatchObject({ ok: true, update: { tableId: a.tableId } });

    // Being replaced is not a disconnection: no grace runs out (DISCONNECT_GRACE_MS = 1000).
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    const satOut = second.updates
      .flatMap((u) => u.events)
      .some((e) => e.type === 'playerSatOut' && e.playerId === a.player.userId);
    expect(satOut).toBe(false);
    expect(second.latest()!.view.seats[a.seat]).toMatchObject({
      playerId: a.player.userId,
      status: 'seated',
    });
  }, 15_000);

  it('garbage amounts are INVALID_MESSAGE and acting elsewhere is NOT_AT_TABLE', async () => {
    const a = await seated('ana', { autoplay: false });
    const { seq } = a.player.latest()!;
    const invalid = { ok: false, error: { type: 'error', code: 'INVALID_MESSAGE' } };
    const notAtTable = { ok: false, error: { type: 'error', code: 'NOT_AT_TABLE' } };

    for (const amount of [-5, 1.5, '100']) {
      const ack = await a.player.emit(SOCKET_EVENTS.act, {
        tableId: a.tableId,
        seq,
        action: { type: 'bet', amount },
      });
      expect(ack).toMatchObject(invalid);
    }
    // The player id comes from the socket, never from the payload.
    expect(
      await a.player.emit(SOCKET_EVENTS.act, {
        tableId: a.tableId,
        seq,
        action: { type: 'fold' },
        playerId: 'dev:beto',
      }),
    ).toMatchObject(invalid);
    expect(await a.player.emit(SOCKET_EVENTS.quickSeat, { buyIn: '1000' })).toMatchObject(invalid);
    expect(
      await a.player.emit(SOCKET_EVENTS.act, {
        tableId: randomUUID(),
        seq,
        action: { type: 'fold' },
      }),
    ).toMatchObject(notAtTable);

    // Somebody not seated at ana's table cannot do anything there.
    const beto = new Player(url, 'beto', { autoplay: false });
    await beto.connected();
    expect(
      await beto.emit(SOCKET_EVENTS.act, { tableId: a.tableId, seq, action: { type: 'fold' } }),
    ).toMatchObject(notAtTable);
    for (const event of [
      SOCKET_EVENTS.sitOut,
      SOCKET_EVENTS.sitIn,
      SOCKET_EVENTS.leave,
      SOCKET_EVENTS.sync,
    ]) {
      expect(await beto.emit(event, { tableId: a.tableId })).toMatchObject(notAtTable);
    }

    // Nothing of that touched ana's seat.
    const sync = await a.player.emit<{ update: TableUpdate }>(SOCKET_EVENTS.sync, {
      tableId: a.tableId,
    });
    expect(sync.ok).toBe(true);
    if (sync.ok) {
      expect(sync.update.view.seats[a.seat]).toMatchObject({ playerId: a.player.userId });
    }
  }, 15_000);

  it('more than SOCKET_RATE_LIMIT_PER_SEC messages in a second are RATE_LIMITED', async () => {
    const client = new Player(url, 'carla', { autoplay: false });
    await client.connected();
    const acks = await Promise.all(
      Array.from({ length: 15 }, () => client.emit(SOCKET_EVENTS.sync, { tableId: 'nowhere' })),
    );
    const codes = acks.map((ack) => (ack.ok ? 'ok' : ack.error.code));
    expect(codes.filter((c) => c === 'NOT_AT_TABLE')).toHaveLength(10);
    expect(codes.filter((c) => c === 'RATE_LIMITED')).toHaveLength(5);
  });

  it('closing the app sends table:closed with reason shutdown', async () => {
    const a = await seated('ana');
    await app!.close();
    app = null;
    await until(
      () => a.player.received.some((r) => r.event === SOCKET_EVENTS.tableClosed),
      2_000,
      'table:closed',
    );
    const closed = a.player.received.find((r) => r.event === SOCKET_EVENTS.tableClosed);
    expect(closed?.payload).toEqual({ tableId: a.tableId, reason: 'shutdown' });
  });
});
