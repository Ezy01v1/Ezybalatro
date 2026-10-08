import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client';
import { auditChips, createTestDatabase, seedProfile, type TestDatabase } from '../db/testing/test-database';
import { PrismaTableStore } from '../tables/prisma-table-store';
import { RecoveryService } from './recovery.service';

const CONFIG = { maxSeats: 6, smallBlind: 10, bigBlind: 20, minBuyIn: 400, maxBuyIn: 2000 };

describe('RecoveryService', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db?.stop();
  });
  beforeEach(async () => {
    await db.reset();
  });

  /** ana (1000 → buys 400) and a bot (500 from the house) seated at an open table. */
  async function seatedTable(): Promise<{ tableId: string; ana: string }> {
    const store = new PrismaTableStore(db.prisma);
    const ana = await seedProfile(db.prisma, 'dev:ana', 1000);
    const tableId = randomUUID();
    await store.openTable(tableId, CONFIG as never);
    expect(await store.sitDown({ tableId, seat: 0, playerId: 'dev:ana', buyIn: 400 })).toBe('ok');
    expect(await store.sitDown({ tableId, seat: 1, playerId: 'bot:Rita', buyIn: 500 })).toBe('ok');
    return { tableId, ana };
  }

  async function balanceOf(userId: string): Promise<bigint> {
    const wallet = await db.prisma.wallet.findUniqueOrThrow({ where: { userId } });
    return wallet.balance;
  }

  it('returns every seated stack to its wallet or the house and closes the tables', async () => {
    const { tableId, ana } = await seatedTable();
    const result = await new RecoveryService(db.prisma).recover();

    expect(result).toEqual({ seats: 2, chips: 900 });
    expect(await balanceOf(ana)).toBe(1000n);
    expect(await db.prisma.seat.count()).toBe(0);
    const table = await db.prisma.pokerTable.findUniqueOrThrow({ where: { id: tableId } });
    expect(table.status).toBe('closed');
    expect(table.closedAt).not.toBeNull();
    const entries = await db.prisma.chipLedger.findMany({ where: { reason: 'recovery_cash_out' } });
    expect(entries).toHaveLength(2);
    const human = entries.find((e) => e.userId === ana);
    expect(human).toMatchObject({ delta: 400n, balanceAfter: 1000n, tableId });
    expect(human?.idempotencyKey).toMatch(/^recovery:[0-9a-f-]{36}$/);
    expect(entries.find((e) => e.userId === null)).toMatchObject({ delta: 500n, tableId });
  });

  it('running recover twice (interrupted then again) never pays a seat twice', async () => {
    const { ana } = await seatedTable();
    // First run dies after the first seat's transaction.
    let calls = 0;
    const flaky = new Proxy(db.prisma, {
      get(target, prop, receiver) {
        if (prop === '$transaction') {
          return (...args: unknown[]) => {
            calls += 1;
            if (calls > 1) return Promise.reject(new Error('connection lost'));
            return (target.$transaction as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as PrismaClient;
    await expect(new RecoveryService(flaky).recover()).rejects.toThrow('connection lost');
    expect(await db.prisma.seat.count()).toBe(1);

    const second = await new RecoveryService(db.prisma).recover();
    expect(second.seats).toBe(1);
    // Two more runs, one of them concurrent: nothing is left to pay.
    const [third, fourth] = await Promise.all([
      new RecoveryService(db.prisma).recover(),
      new RecoveryService(db.prisma).recover(),
    ]);
    expect(third).toEqual({ seats: 0, chips: 0 });
    expect(fourth).toEqual({ seats: 0, chips: 0 });

    expect(await balanceOf(ana)).toBe(1000n);
    expect(await db.prisma.chipLedger.count({ where: { reason: 'recovery_cash_out' } })).toBe(2);
    await auditChips(db.prisma);
  });

  it('auditChips holds after recovery', async () => {
    const { tableId } = await seatedTable();
    await seedProfile(db.prisma, 'dev:bea', 800);
    await new PrismaTableStore(db.prisma).sitDown({ tableId, seat: 2, playerId: 'dev:bea', buyIn: 700 });
    await new RecoveryService(db.prisma).recover();
    await expect(auditChips(db.prisma)).resolves.toBeUndefined();
  });

  it('a zero stack seat is removed without a ledger entry', async () => {
    const { tableId } = await seatedTable();
    await db.prisma.seat.updateMany({ where: { tableId, seatIndex: 1 }, data: { stack: 0n } });
    await db.prisma.chipLedger.create({ data: { userId: null, delta: 500n, reason: 'bot_cash_out', tableId } });
    const result = await new RecoveryService(db.prisma).recover();
    expect(result).toEqual({ seats: 2, chips: 400 });
    expect(await db.prisma.chipLedger.count({ where: { reason: 'recovery_cash_out' } })).toBe(1);
    await auditChips(db.prisma);
  });
});
