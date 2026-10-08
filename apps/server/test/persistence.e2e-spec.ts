// Must be the first import: it sets the fast table timings before `AppModule` validates the env.
import './table-env';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SOCKET_EVENTS, type Ack, type TableUpdate } from '@naipes/shared';
import { io, type Socket } from 'socket.io-client';
import { auditChips, type TestDatabase } from '../src/db/testing/test-database';
import { setupApp } from '../src/setup-app';
import { PrismaTableStore } from '../src/tables/prisma-table-store';
import { loadAppModule, startE2eDatabase } from './test-database-env';

const CHIPS_INITIAL = 10_000n;

/** Per player, the stack the client saw at the end of each settled hand (keyed by hand number). */
const settledStacks = new Map<string, Map<number, bigint>>();

/** Connects as `dev:<name>`; with autoplay it checks or calls whenever it may act. */
function connect(url: string, name: string, autoplay = false): Promise<Socket> {
  const socket = io(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { token: `dev:${name}` },
  });
  let acted = -1;
  socket.on(SOCKET_EVENTS.tableUpdate, (update: TableUpdate) => {
    const legal = update.view.legal;
    if (!autoplay || !legal || update.seq <= acted) return;
    acted = update.seq;
    const action = legal.canCheck ? { type: 'check' } : { type: 'call' };
    socket.emit(SOCKET_EVENTS.act, { tableId: update.tableId, seq: update.seq, action }, () => undefined);
  });
  // The player's stack at the end of each settled hand, for an optional cross-check with the DB.
  socket.on(SOCKET_EVENTS.tableUpdate, (update: TableUpdate) => {
    const seat = update.view.mySeat;
    if (seat === null) return;
    for (const e of update.events) {
      if (e.type !== 'handSettled') continue;
      const mine = e.stacks.find((s) => s.seat === seat);
      if (!mine) continue;
      const byHand = settledStacks.get(name) ?? new Map<number, bigint>();
      byHand.set(e.handNumber, BigInt(mine.stack));
      settledStacks.set(name, byHand);
    }
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

async function poll<T>(read: () => Promise<T | null>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('Persistence (e2e)', () => {
  let db: TestDatabase;
  let app: INestApplication | null = null;
  let url: string;
  const sockets: Socket[] = [];

  async function startApp(): Promise<void> {
    const moduleRef = await Test.createTestingModule({ imports: [await loadAppModule()] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  }

  async function stopApp(): Promise<void> {
    for (const socket of sockets.splice(0)) socket.disconnect();
    await app?.close();
    app = null;
  }

  async function join(name: string, autoplay = false): Promise<Socket> {
    const socket = await connect(url, name, autoplay);
    sockets.push(socket);
    return socket;
  }

  async function walletOf(handle: string): Promise<bigint> {
    const profile = await db.prisma.profile.findUniqueOrThrow({
      where: { devHandle: handle },
      include: { wallet: true },
    });
    return profile.wallet!.balance;
  }

  beforeAll(async () => {
    db = await startE2eDatabase();
  });
  beforeEach(async () => {
    settledStacks.clear();
    await db.reset();
    await startApp();
  });
  afterEach(stopApp);
  afterAll(async () => {
    await stopApp();
    await db?.stop();
  });

  it('a new user gets 10000 chips on first connection', async () => {
    await join('nueva');
    expect(await walletOf('dev:nueva')).toBe(CHIPS_INITIAL);
    // Connecting again never pays the initial chips twice.
    await join('nueva');
    expect(await walletOf('dev:nueva')).toBe(CHIPS_INITIAL);
    await auditChips(db.prisma);
  });

  it('a hand played over Socket.IO is persisted with its actions', async () => {
    const ana = await join('ana', true);
    const ack = (await ana.timeout(5000).emitWithAck(SOCKET_EVENTS.quickSeat, {})) as Ack<{ tableId: string }>;
    expect(ack.ok).toBe(true);
    const tableId = ack.ok ? ack.tableId : '';

    const hand = await poll(
      () => db.prisma.hand.findFirst({ where: { tableId }, include: { actions: true } }),
      20_000,
      'a persisted hand',
    );
    expect(hand.status).toBe('settled');
    expect(hand.actions.length).toBeGreaterThan(0);
    expect(await db.prisma.pokerTable.count({ where: { id: tableId, status: { not: 'closed' } } })).toBe(1);
    await auditChips(db.prisma);
  });

  it("after a server restart the player's chips are back in the wallet", async () => {
    const ana = await join('ana', true);
    const ack = (await ana.timeout(5000).emitWithAck(SOCKET_EVENTS.quickSeat, {})) as Ack<{ tableId: string }>;
    expect(ack.ok).toBe(true);
    await poll(() => db.prisma.hand.findFirst(), 20_000, 'a persisted hand');

    await stopApp();
    // Graceful shutdown: the hand in progress is voided and ana is paid her stack at the end of the
    // last saved hand. The DB is the oracle: wallet = balance after the buy-in + every cash-out
    // credited to her afterwards (none if her stack was 0).
    expect(await db.prisma.seat.count()).toBe(0);
    const buyIn = await db.prisma.chipLedger.findFirstOrThrow({
      where: { profile: { devHandle: 'dev:ana' }, reason: 'buy_in' },
      orderBy: { createdAt: 'desc' },
    });
    const cashOuts = await db.prisma.chipLedger.findMany({
      where: {
        profile: { devHandle: 'dev:ana' },
        reason: { in: ['cash_out', 'recovery_cash_out'] },
        createdAt: { gte: buyIn.createdAt },
      },
    });
    const paid = cashOuts.reduce((sum, e) => sum + e.delta, 0n);
    const afterClose = await walletOf('dev:ana');
    expect(afterClose).toBe(buyIn.balanceAfter! + paid);
    await auditChips(db.prisma);

    // Cross-check with what the client saw, only if it saw the last settled hand that was saved.
    const lastSaved = await db.prisma.hand.findFirst({
      where: { status: 'settled' },
      orderBy: { handNumber: 'desc' },
    });
    const seen = lastSaved ? settledStacks.get('ana')?.get(lastSaved.handNumber) : undefined;
    if (seen !== undefined) expect(paid).toBe(seen);

    await startApp();
    await join('ana');
    expect(await walletOf('dev:ana')).toBe(afterClose);
    await auditChips(db.prisma);
  });

  it('startup recovery returns the seats a crashed process left behind', async () => {
    await join('bea');
    await stopApp();
    // A process that died mid-session: open table, bea and a bot still seated.
    const store = new PrismaTableStore(db.prisma);
    const tableId = randomUUID();
    await store.openTable(tableId, { maxSeats: 6, smallBlind: 10, bigBlind: 20, minBuyIn: 400, maxBuyIn: 2000 } as never);
    await store.sitDown({ tableId, seat: 0, playerId: 'dev:bea', buyIn: 1500 });
    await store.sitDown({ tableId, seat: 1, playerId: 'bot:Rita', buyIn: 800 });
    expect(await walletOf('dev:bea')).toBe(CHIPS_INITIAL - 1500n);

    await startApp();
    expect(await walletOf('dev:bea')).toBe(CHIPS_INITIAL);
    expect(await db.prisma.seat.count()).toBe(0);
    expect((await db.prisma.pokerTable.findUniqueOrThrow({ where: { id: tableId } })).status).toBe('closed');
    await join('bea');
    await auditChips(db.prisma);
  });
});
