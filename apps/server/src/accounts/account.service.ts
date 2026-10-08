import type { PrismaClient } from '../generated/prisma/client';
import type { AccountPort } from './account-port';

export interface AccountOptions {
  /** Chips in a new account's wallet. */
  initial: number;
  /** The daily refill tops a wallet below this up to it. */
  refillTo: number;
}

function chips(amount: number): bigint {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`Invalid chip amount: ${amount}`);
  return BigInt(amount);
}

/**
 * Accounts and the daily refill (spec §3.4). Wallet changes are conditional `UPDATE`s / `INSERT ...
 * ON CONFLICT DO NOTHING` with their `chip_ledger` entry in the same transaction (invariant 7).
 * Time is always the `now` the caller injects.
 */
export class AccountService implements AccountPort {
  private readonly initial: bigint;
  private readonly refillTo: bigint;

  constructor(
    private readonly prisma: PrismaClient,
    opts: AccountOptions,
  ) {
    this.initial = chips(opts.initial);
    this.refillTo = chips(opts.refillTo);
  }

  /** Returns the profile id; creates profile + wallet + `initial` ledger entry only the first time. */
  async ensureAccount(devHandle: string): Promise<string> {
    const nickname = devHandle.replace(/^dev:/, '');
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO profiles (id, dev_handle, nickname, updated_at)
        VALUES (gen_random_uuid(), ${devHandle}, ${nickname}, now())
        ON CONFLICT (dev_handle) DO NOTHING
        RETURNING id::text AS id`;
      const row = created[0];
      if (row) {
        await tx.$executeRaw`
          INSERT INTO wallets (user_id, balance) VALUES (${row.id}::uuid, ${this.initial})`;
        await tx.$executeRaw`
          INSERT INTO chip_ledger (id, user_id, delta, balance_after, reason, idempotency_key)
          VALUES (gen_random_uuid(), ${row.id}::uuid, ${this.initial}, ${this.initial}, 'initial', 'initial')`;
        return row.id;
      }
      const existing = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM profiles WHERE dev_handle = ${devHandle}`;
      const found = existing[0];
      if (!found) throw new Error('Account vanished after conflict');
      return found.id;
    });
  }

  /** Tops the wallet up to `refillTo` at most once per UTC day; returns the chips added (0 if none). */
  async applyDailyRefill(devHandle: string, now: Date): Promise<number> {
    const day = now.toISOString().slice(0, 10);
    const key = `refill:${day}`;
    const at = now.toISOString(); // explicit UTC: a Date binds as a zone-less timestamp
    return this.prisma.$transaction(async (tx) => {
      // The row lock serialises concurrent refills of the same wallet and gives the balance before.
      const locked = await tx.$queryRaw<{ user_id: string; balance: bigint }[]>`
        SELECT w.user_id::text AS user_id, w.balance FROM wallets w
        JOIN profiles p ON p.id = w.user_id
        WHERE p.dev_handle = ${devHandle}
        FOR UPDATE OF w`;
      const before = locked[0];
      if (!before) throw new Error(`No wallet for ${devHandle}`);
      const updated = await tx.$queryRaw<{ balance: bigint }[]>`
        UPDATE wallets SET balance = ${this.refillTo}, last_daily_refill_at = ${at}::timestamptz
        WHERE user_id = ${before.user_id}::uuid
          AND balance < ${this.refillTo}
          AND (last_daily_refill_at IS NULL
               OR last_daily_refill_at < date_trunc('day', ${at}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
        RETURNING balance`;
      const row = updated[0];
      if (!row) return 0;
      const delta = row.balance - before.balance;
      await tx.$executeRaw`
        INSERT INTO chip_ledger (id, user_id, delta, balance_after, reason, idempotency_key)
        VALUES (gen_random_uuid(), ${before.user_id}::uuid, ${delta}, ${row.balance}, 'daily_refill', ${key})`;
      return Number(delta);
    });
  }
}
