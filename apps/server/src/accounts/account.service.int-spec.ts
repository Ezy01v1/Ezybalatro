import {
  auditChips,
  createTestDatabase,
  type TestDatabase,
} from '../db/testing/test-database';
import { AccountService } from './account.service';

const OPTS = { initial: 10000, refillTo: 2000 };

describe('AccountService', () => {
  let db: TestDatabase;
  let service: AccountService;

  beforeAll(async () => {
    db = await createTestDatabase();
    service = new AccountService(db.prisma, OPTS);
  });
  afterAll(async () => {
    await db?.stop();
  });
  beforeEach(async () => {
    await db.reset();
  });

  const walletOf = async (handle: string) =>
    db.prisma.wallet.findFirstOrThrow({ where: { profile: { devHandle: handle } } });
  const ledgerOf = (handle: string) =>
    db.prisma.chipLedger.findMany({
      where: { profile: { devHandle: handle } },
      orderBy: { createdAt: 'asc' },
    });
  const setBalance = async (handle: string, balance: number) => {
    const w = await walletOf(handle);
    // Test setup: a buy-in on a fresh table, so wallets + stacks still match the ledger (audit).
    const moved = w.balance - BigInt(balance);
    if (moved < 0n) throw new Error('setBalance only lowers balances');
    const table = await db.prisma.pokerTable.create({
      data: { status: 'open', maxSeats: 6, smallBlind: 5n, bigBlind: 10n, minBuyIn: 1n, maxBuyIn: 100000n },
    });
    await db.prisma.wallet.update({ where: { userId: w.userId }, data: { balance: BigInt(balance) } });
    await db.prisma.chipLedger.create({
      data: { userId: w.userId, delta: -moved, balanceAfter: BigInt(balance), reason: 'buy_in', tableId: table.id },
    });
    await db.prisma.seat.create({
      data: { tableId: table.id, seatIndex: 0, userId: w.userId, stack: moved },
    });
  };

  it('creates profile, wallet with 10000 and one initial ledger row', async () => {
    const id = await service.ensureAccount('dev:ana');
    const profile = await db.prisma.profile.findUniqueOrThrow({ where: { devHandle: 'dev:ana' } });
    expect(profile.id).toBe(id);
    expect(profile.nickname).toBe('ana');
    expect((await walletOf('dev:ana')).balance).toBe(10000n);
    const ledger = await ledgerOf('dev:ana');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      delta: 10000n,
      balanceAfter: 10000n,
      reason: 'initial',
      idempotencyKey: 'initial',
    });
    await auditChips(db.prisma);
  });

  it('ensureAccount twice (and concurrently x5) creates one account and one initial', async () => {
    const first = await service.ensureAccount('dev:bob');
    expect(await service.ensureAccount('dev:bob')).toBe(first);
    const ids = await Promise.all(Array.from({ length: 5 }, () => service.ensureAccount('dev:cy')));
    expect(new Set(ids).size).toBe(1);
    expect(await db.prisma.profile.count()).toBe(2);
    expect(await db.prisma.wallet.count()).toBe(2);
    expect(await ledgerOf('dev:cy')).toHaveLength(1);
    expect(await ledgerOf('dev:bob')).toHaveLength(1);
    await auditChips(db.prisma);
  });

  it('refills to 2000 when balance is below 2000, once per UTC day', async () => {
    await service.ensureAccount('dev:ana');
    await setBalance('dev:ana', 500);
    const now = new Date('2026-10-08T12:00:00Z');
    expect(await service.applyDailyRefill('dev:ana', now)).toBe(1500);
    expect((await walletOf('dev:ana')).balance).toBe(2000n);
    const refill = (await ledgerOf('dev:ana')).find((l) => l.reason === 'daily_refill');
    expect(refill).toMatchObject({
      delta: 1500n,
      balanceAfter: 2000n,
      idempotencyKey: 'refill:2026-10-08',
    });
    await setBalance('dev:ana', 100);
    expect(await service.applyDailyRefill('dev:ana', new Date('2026-10-08T18:00:00Z'))).toBe(0);
    expect((await walletOf('dev:ana')).balance).toBe(100n);
    await auditChips(db.prisma);
  });

  it('does not refill when balance >= 2000', async () => {
    await service.ensureAccount('dev:ana');
    expect(await service.applyDailyRefill('dev:ana', new Date('2026-10-08T12:00:00Z'))).toBe(0);
    await setBalance('dev:ana', 2000);
    expect(await service.applyDailyRefill('dev:ana', new Date('2026-10-09T12:00:00Z'))).toBe(0);
    expect((await ledgerOf('dev:ana')).filter((l) => l.reason === 'daily_refill')).toHaveLength(0);
  });

  it('refills again on the next UTC day: 23:59:59Z then 00:00:00Z', async () => {
    await service.ensureAccount('dev:ana');
    await setBalance('dev:ana', 0);
    expect(await service.applyDailyRefill('dev:ana', new Date('2026-10-08T23:59:59Z'))).toBe(2000);
    await setBalance('dev:ana', 0);
    expect(await service.applyDailyRefill('dev:ana', new Date('2026-10-08T23:59:59.500Z'))).toBe(0);
    expect(await service.applyDailyRefill('dev:ana', new Date('2026-10-09T00:00:00Z'))).toBe(2000);
    const keys = (await ledgerOf('dev:ana'))
      .filter((l) => l.reason === 'daily_refill')
      .map((l) => l.idempotencyKey);
    expect(keys).toEqual(['refill:2026-10-08', 'refill:2026-10-09']);
    await auditChips(db.prisma);
  });

  it('concurrent refills on the same day add chips once', async () => {
    await service.ensureAccount('dev:ana');
    await setBalance('dev:ana', 300);
    const now = new Date('2026-10-08T12:00:00Z');
    const added = await Promise.all(
      Array.from({ length: 5 }, () => service.applyDailyRefill('dev:ana', now)),
    );
    expect(added.reduce((a, b) => a + b, 0)).toBe(1700);
    expect((await walletOf('dev:ana')).balance).toBe(2000n);
    expect((await ledgerOf('dev:ana')).filter((l) => l.reason === 'daily_refill')).toHaveLength(1);
    await auditChips(db.prisma);
  });

  it('auditChips holds after accounts and refills', async () => {
    for (const h of ['dev:a', 'dev:b', 'dev:c']) await service.ensureAccount(h);
    await setBalance('dev:b', 50);
    await service.applyDailyRefill('dev:b', new Date('2026-10-08T01:00:00Z'));
    await service.applyDailyRefill('dev:a', new Date('2026-10-08T01:00:00Z'));
    await auditChips(db.prisma);
  });
});
