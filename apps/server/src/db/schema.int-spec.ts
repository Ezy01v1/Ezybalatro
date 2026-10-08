import { auditChips, createTestDatabase, type TestDatabase } from './testing/test-database';

const TABLES = ['tables', 'seats', 'hands', 'hand_actions', 'profiles', 'wallets', 'chip_ledger'];

describe('database schema', () => {
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

  async function createProfile(handle: string): Promise<string> {
    const profile = await db.prisma.profile.create({
      data: { devHandle: handle, nickname: handle, wallet: { create: { balance: 100n } } },
    });
    return profile.id;
  }

  async function createTable(): Promise<string> {
    const table = await db.prisma.pokerTable.create({
      data: { status: 'open', maxSeats: 6, smallBlind: 5n, bigBlind: 10n, minBuyIn: 200n, maxBuyIn: 1000n },
    });
    return table.id;
  }

  it('applies the migrations and has every table', async () => {
    const rows = await db.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const names = rows.map((r) => r.table_name);
    for (const t of TABLES) expect(names).toContain(t);
  });

  it('rejects a negative wallet balance with a CHECK', async () => {
    const userId = await createProfile('dev:ana');
    await expect(
      db.prisma.$executeRaw`UPDATE wallets SET balance = -1 WHERE user_id = ${userId}::uuid`,
    ).rejects.toThrow(/wallets_balance_non_negative|check constraint/i);
  });

  it('rejects a negative seat stack and a seat with both user and bot', async () => {
    const userId = await createProfile('dev:ana');
    const tableId = await createTable();
    await expect(
      db.prisma.seat.create({ data: { tableId, seatIndex: 0, botName: 'Bot', stack: -1n } }),
    ).rejects.toThrow();
    await expect(
      db.prisma.seat.create({ data: { tableId, seatIndex: 1, userId, botName: 'Bot', stack: 100n } }),
    ).rejects.toThrow();
    await expect(db.prisma.seat.create({ data: { tableId, seatIndex: 2, stack: 100n } })).rejects.toThrow();
    await expect(
      db.prisma.seat.create({ data: { tableId, seatIndex: 3, userId, stack: 100n } }),
    ).resolves.toBeDefined();
  });

  it('rejects a zero ledger delta', async () => {
    await expect(db.prisma.chipLedger.create({ data: { delta: 0n, reason: 'bot_buy_in' } })).rejects.toThrow();
  });

  it('enforces unique (user_id, idempotency_key) on the ledger', async () => {
    const userId = await createProfile('dev:ana');
    const entry = { userId, delta: 100n, balanceAfter: 100n, reason: 'initial' as const, idempotencyKey: 'k1' };
    await db.prisma.chipLedger.create({ data: entry });
    await expect(db.prisma.chipLedger.create({ data: entry })).rejects.toThrow();
    // Entries without a key are never deduplicated.
    await db.prisma.chipLedger.create({ data: { ...entry, idempotencyKey: null } });
    await db.prisma.chipLedger.create({ data: { ...entry, idempotencyKey: null } });
    expect(await db.prisma.chipLedger.count()).toBe(3);
  });

  it('has row level security enabled on every table', async () => {
    const rows = await db.prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`;
    expect(rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
    for (const r of rows) expect(r).toEqual({ relname: r.relname, relrowsecurity: true });
  });

  it('auditChips passes on an empty database', async () => {
    await expect(auditChips(db.prisma)).resolves.toBeUndefined();
  });

  it('auditChips fails when a wallet does not match its ledger', async () => {
    await createProfile('dev:ana'); // balance 100 with no ledger entry
    await expect(auditChips(db.prisma)).rejects.toThrow(/wallet/i);
  });

  it('auditChips passes on a consistent set of movements and fails on chips created from nothing', async () => {
    const userId = await db.prisma.profile
      .create({ data: { devHandle: 'dev:ana', nickname: 'ana', wallet: { create: { balance: 700n } } } })
      .then((p) => p.id);
    const tableId = await createTable();
    await db.prisma.chipLedger.createMany({
      data: [
        { userId, delta: 1000n, balanceAfter: 1000n, reason: 'initial' },
        { userId, delta: -300n, balanceAfter: 700n, reason: 'buy_in', tableId },
        { userId: null, delta: -500n, reason: 'bot_buy_in', tableId },
      ],
    });
    await db.prisma.seat.createMany({
      data: [
        { tableId, seatIndex: 0, userId, stack: 300n },
        { tableId, seatIndex: 1, botName: 'Bot', stack: 500n },
      ],
    });
    await expect(auditChips(db.prisma)).resolves.toBeUndefined();

    await db.prisma.seat.update({
      where: { tableId_seatIndex: { tableId, seatIndex: 1 } },
      data: { stack: 501n },
    });
    await expect(auditChips(db.prisma)).rejects.toThrow(/conservation/i);
  });
});
