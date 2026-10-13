import { NICKNAME_REGEX } from '@naipes/shared';
import type { PrismaClient } from '../generated/prisma/client';
import { randomInt } from 'node:crypto';
import {
  AccountBusyError,
  AccountDeletedError,
  type AccountDeletionPort,
  NicknameTakenError,
  type AccountKey,
  type AccountPort,
  type Profile,
  type ProfilePort,
} from './account-port';

export interface AccountOptions {
  /** Chips in a new account's wallet. */
  initial: number;
  /** The daily refill tops a wallet below this up to it. */
  refillTo: number;
  /** Uniform integer in [0, max): digits of automatic nicknames (crypto by default; tests inject it). */
  randomInt?: (max: number) => number;
}

/** Automatic nicknames tried before giving up. */
const NICKNAME_ATTEMPTS = 20;

/** Postgres unique violation (23505), however Prisma or its driver adapter wraps it. */
export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== 'object' || value === null || seen.has(value) || depth > 6) return false;
    seen.add(value);
    const v = value as Record<string, unknown>;
    if (v.code === '23505' || v.code === 'P2002' || v.originalCode === '23505') return true;
    if (v.kind === 'UniqueConstraintViolation') return true;
    return Object.values(v).some((child) => visit(child, depth + 1)) || visit(v.cause, depth + 1);
  };
  return visit(error, 0);
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
export class AccountService implements AccountPort, ProfilePort, AccountDeletionPort {
  private readonly initial: bigint;
  private readonly refillTo: bigint;
  private readonly randomInt: (max: number) => number;

  constructor(
    private readonly prisma: PrismaClient,
    opts: AccountOptions,
  ) {
    this.initial = chips(opts.initial);
    this.refillTo = chips(opts.refillTo);
    this.randomInt = opts.randomInt ?? ((max) => randomInt(max));
  }

  /**
   * Returns the profile id; creates profile + wallet + `initial` ledger entry only the first time.
   * A live profile without nickname then gets one: the dev handle's name when valid and free,
   * otherwise an automatic `Jugador<4 digits>`.
   */
  async ensureAccount(key: AccountKey): Promise<string> {
    if ('devHandle' in key) {
      const id = await this.createOnce(key.devHandle, null);
      const name = key.devHandle.replace(/^dev:/, '');
      await this.ensureNickname(id, NICKNAME_REGEX.test(name) ? name : null);
      return id;
    }
    const id = await this.createOnce(null, key.userId);
    await this.ensureNickname(id, null);
    return id;
  }

  /** Profile (by dev handle or by id) + wallet + `initial` ledger, atomically and only once. */
  private createOnce(devHandle: string | null, userId: string | null): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const created = devHandle !== null
        ? await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO profiles (id, dev_handle, updated_at)
            VALUES (gen_random_uuid(), ${devHandle}, now())
            ON CONFLICT (dev_handle) DO NOTHING
            RETURNING id::text AS id`
        : await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO profiles (id, updated_at)
            VALUES (${userId}::uuid, now())
            ON CONFLICT (id) DO NOTHING
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
      // Already there: return it unless deleted (a deleted profile is never resurrected).
      const existing = userId !== null
        ? await tx.$queryRaw<{ id: string; deleted: boolean }[]>`
            SELECT id::text AS id, deleted_at IS NOT NULL AS deleted FROM profiles WHERE id = ${userId}::uuid`
        : await tx.$queryRaw<{ id: string; deleted: boolean }[]>`
            SELECT id::text AS id, deleted_at IS NOT NULL AS deleted FROM profiles WHERE dev_handle = ${devHandle}`;
      const found = existing[0];
      if (!found) throw new Error('Account vanished after conflict');
      if (found.deleted) throw new AccountDeletedError();
      return found.id;
    });
  }

  /**
   * Gives a live profile without nickname one: `preferred` first (when given), then automatic ones.
   * Each attempt is a single conditional `UPDATE`; a unique conflict just tries the next candidate.
   */
  private async ensureNickname(id: string, preferred: string | null): Promise<void> {
    const candidates = preferred !== null ? [preferred] : [];
    for (let i = 0; i < NICKNAME_ATTEMPTS; i++) candidates.push(this.autoNickname());
    for (const candidate of candidates) {
      try {
        await this.prisma.$executeRaw`
          UPDATE profiles SET nickname = ${candidate}, updated_at = now()
          WHERE id = ${id}::uuid AND nickname IS NULL AND deleted_at IS NULL`;
        return; // set now, or it already had one (or is deleted): nothing to do either way
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new Error(`Could not assign a free nickname after ${NICKNAME_ATTEMPTS} attempts`);
  }

  private autoNickname(): string {
    return `Jugador${String(this.randomInt(10000)).padStart(4, '0')}`;
  }

  async profile(userId: string): Promise<Profile | null> {
    const rows = await this.prisma.$queryRaw<{ nickname: string | null; avatar_id: string | null; balance: bigint }[]>`
      SELECT p.nickname, p.avatar_id, w.balance FROM profiles p JOIN wallets w ON w.user_id = p.id
      WHERE p.id = ${userId}::uuid AND p.deleted_at IS NULL`;
    const row = rows[0];
    if (!row || row.nickname === null) return null;
    return { nickname: row.nickname, avatarId: row.avatar_id, balance: Number(row.balance) };
  }

  async updateProfile(
    userId: string,
    changes: { nickname?: string; avatarId?: string },
  ): Promise<Profile | null> {
    const nickname = changes.nickname ?? null;
    const avatarId = changes.avatarId ?? null;
    try {
      await this.prisma.$executeRaw`
        UPDATE profiles
        SET nickname = COALESCE(${nickname}::text, nickname),
            avatar_id = COALESCE(${avatarId}::text, avatar_id),
            updated_at = now()
        WHERE id = ${userId}::uuid AND deleted_at IS NULL`;
    } catch (error) {
      if (isUniqueViolation(error)) throw new NicknameTakenError();
      throw error;
    }
    return this.profile(userId);
  }

  async isDeleted(userId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ deleted: boolean }[]>`
      SELECT deleted_at IS NOT NULL AS deleted FROM profiles WHERE id = ${userId}::uuid`;
    return rows[0]?.deleted === true;
  }

  /** Tops the wallet up to `refillTo` at most once per UTC day; returns the chips added (0 if none). */
  async applyDailyRefill(userId: string, now: Date): Promise<number> {
    const day = now.toISOString().slice(0, 10);
    const key = `refill:${day}`;
    const at = now.toISOString(); // explicit UTC: a Date binds as a zone-less timestamp
    return this.prisma.$transaction(async (tx) => {
      // The row lock serialises concurrent refills of the same wallet and gives the balance before.
      // The profile lock orders the refill against a concurrent deleteAccount (FOR UPDATE there).
      const profile = await tx.$queryRaw<{ deleted: boolean }[]>`
        SELECT deleted_at IS NOT NULL AS deleted FROM profiles WHERE id = ${userId}::uuid FOR SHARE`;
      if (profile[0]?.deleted === true) return 0; // a deleted account is never refilled
      const locked = await tx.$queryRaw<{ user_id: string; balance: bigint }[]>`
        SELECT w.user_id::text AS user_id, w.balance FROM wallets w
        WHERE w.user_id = ${userId}::uuid
        FOR UPDATE`;
      const before = locked[0];
      if (!before) throw new Error(`No wallet for ${userId}`);
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

  async deleteAccount(userId: string): Promise<'deleted' | 'already'> {
    return this.prisma.$transaction(async (tx) => {
      // The profile row lock serialises concurrent deletions (and the wallet lock below the debit).
      const locked = await tx.$queryRaw<{ deleted: boolean }[]>`
        SELECT deleted_at IS NOT NULL AS deleted FROM profiles WHERE id = ${userId}::uuid FOR UPDATE`;
      const profile = locked[0];
      if (!profile || profile.deleted) return 'already';
      const seats = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM seats WHERE user_id = ${userId}::uuid`;
      if ((seats[0]?.n ?? 0n) > 0n) throw new AccountBusyError();
      const wallet = await tx.$queryRaw<{ balance: bigint }[]>`
        SELECT balance FROM wallets WHERE user_id = ${userId}::uuid FOR UPDATE`;
      const balance = wallet[0]?.balance ?? 0n;
      if (balance > 0n) {
        const updated = await tx.$executeRaw`
          UPDATE wallets SET balance = 0 WHERE user_id = ${userId}::uuid AND balance = ${balance}`;
        if (updated !== 1) throw new Error('Wallet changed during account deletion');
        await tx.$executeRaw`
          INSERT INTO chip_ledger (id, user_id, delta, balance_after, reason, idempotency_key)
          VALUES (gen_random_uuid(), ${userId}::uuid, ${-balance}, 0, 'account_deleted', 'account_deleted')`;
      }
      await tx.$executeRaw`
        UPDATE profiles
        SET nickname = NULL, dev_handle = NULL, avatar_id = NULL, deleted_at = now(), updated_at = now()
        WHERE id = ${userId}::uuid`;
      return 'deleted';
    });
  }

  async pendingAuthDeletions(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM profiles
      WHERE deleted_at IS NOT NULL AND auth_deleted_at IS NULL ORDER BY deleted_at, id`;
    return rows.map((r) => r.id);
  }

  async markAuthDeleted(userId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE profiles SET auth_deleted_at = now() WHERE id = ${userId}::uuid AND auth_deleted_at IS NULL`;
  }
}
