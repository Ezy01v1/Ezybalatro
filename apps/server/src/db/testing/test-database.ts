import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { startEmbeddedDatabase } from '../embedded-database';

export interface TestDatabase {
  prisma: PrismaClient;
  url: string;
  /** Empties every table (TRUNCATE ... RESTART IDENTITY CASCADE). */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

/** One embedded Postgres per suite, migrated, with a connected client. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const db = await startEmbeddedDatabase();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: db.url }) });
  try {
    await prisma.$connect();
  } catch (err) {
    await db.stop();
    throw err;
  }
  return {
    prisma,
    url: db.url,
    async reset() {
      const rows = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      if (rows.length === 0) return;
      const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    },
    async stop() {
      await prisma.$disconnect();
      await db.stop();
    },
  };
}

/**
 * Global chip audit (spec §2). Throws when:
 * (a) a wallet balance differs from the sum of its ledger deltas, or
 * (b) Σ wallets + Σ seat stacks ≠ Σ user (initial + daily_refill) deltas − Σ house deltas.
 */
export async function auditChips(prisma: PrismaClient): Promise<void> {
  const mismatched = await prisma.$queryRaw<{ user_id: string; balance: bigint; ledger: bigint }[]>`
    SELECT w.user_id::text AS user_id, w.balance, COALESCE(SUM(l.delta), 0)::bigint AS ledger
    FROM wallets w LEFT JOIN chip_ledger l ON l.user_id = w.user_id
    GROUP BY w.user_id, w.balance
    HAVING w.balance <> COALESCE(SUM(l.delta), 0)`;
  if (mismatched.length > 0) {
    const detail = mismatched.map((m) => `${m.user_id}: balance ${m.balance}, ledger ${m.ledger}`).join('; ');
    throw new Error(`chip audit (a) failed, wallet balance differs from ledger: ${detail}`);
  }

  const [row] = await prisma.$queryRaw<{ held: bigint; minted: bigint; house: bigint }[]>`
    SELECT
      (SELECT COALESCE(SUM(balance), 0) FROM wallets)::bigint + (SELECT COALESCE(SUM(stack), 0) FROM seats)::bigint AS held,
      (SELECT COALESCE(SUM(delta), 0) FROM chip_ledger
        WHERE user_id IS NOT NULL AND reason IN ('initial', 'daily_refill'))::bigint AS minted,
      (SELECT COALESCE(SUM(delta), 0) FROM chip_ledger WHERE user_id IS NULL)::bigint AS house`;
  const totals = row ?? { held: 0n, minted: 0n, house: 0n };
  const expected = totals.minted - totals.house;
  if (totals.held !== expected) {
    throw new Error(
      `chip audit (b) failed, conservation broken: wallets + stacks = ${totals.held}, expected ${expected} ` +
        `(minted ${totals.minted}, house ${totals.house})`,
    );
  }
}

/**
 * Creates a profile with a wallet of `balance` chips, ledgered as `initial` so `auditChips` holds.
 * Test-only stand-in for `AccountService`.
 */
export async function seedProfile(prisma: PrismaClient, devHandle: string, balance: number): Promise<string> {
  const amount = BigInt(balance);
  const profile = await prisma.profile.create({
    data: { devHandle, nickname: devHandle.replace(/^dev:/, ''), wallet: { create: { balance: amount } } },
  });
  if (amount !== 0n) {
    await prisma.chipLedger.create({
      data: { userId: profile.id, delta: amount, balanceAfter: amount, reason: 'initial' },
    });
  }
  return profile.id;
}
