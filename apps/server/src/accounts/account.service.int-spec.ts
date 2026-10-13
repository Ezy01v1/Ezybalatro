import { randomUUID } from 'node:crypto';
import {
  auditChips,
  createTestDatabase,
  type TestDatabase,
} from '../db/testing/test-database';
import { AccountBusyError, AccountDeletedError, NicknameTakenError } from './account-port';
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

  const idOf = async (handle: string) =>
    (await db.prisma.profile.findUniqueOrThrow({ where: { devHandle: handle } })).id;
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
    const id = await service.ensureAccount({ devHandle: 'dev:ana' });
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
    const first = await service.ensureAccount({ devHandle: 'dev:bob' });
    expect(await service.ensureAccount({ devHandle: 'dev:bob' })).toBe(first);
    const ids = await Promise.all(Array.from({ length: 5 }, () => service.ensureAccount({ devHandle: 'dev:cy' })));
    expect(new Set(ids).size).toBe(1);
    expect(await db.prisma.profile.count()).toBe(2);
    expect(await db.prisma.wallet.count()).toBe(2);
    expect(await ledgerOf('dev:cy')).toHaveLength(1);
    expect(await ledgerOf('dev:bob')).toHaveLength(1);
    await auditChips(db.prisma);
  });

  it('refills to 2000 when balance is below 2000, once per UTC day', async () => {
    await service.ensureAccount({ devHandle: 'dev:ana' });
    await setBalance('dev:ana', 500);
    const now = new Date('2026-10-08T12:00:00Z');
    expect(await service.applyDailyRefill(await idOf('dev:ana'), now)).toBe(1500);
    expect((await walletOf('dev:ana')).balance).toBe(2000n);
    const refill = (await ledgerOf('dev:ana')).find((l) => l.reason === 'daily_refill');
    expect(refill).toMatchObject({
      delta: 1500n,
      balanceAfter: 2000n,
      idempotencyKey: 'refill:2026-10-08',
    });
    await setBalance('dev:ana', 100);
    expect(await service.applyDailyRefill(await idOf('dev:ana'), new Date('2026-10-08T18:00:00Z'))).toBe(0);
    expect((await walletOf('dev:ana')).balance).toBe(100n);
    await auditChips(db.prisma);
  });

  it('does not refill when balance >= 2000', async () => {
    await service.ensureAccount({ devHandle: 'dev:ana' });
    expect(await service.applyDailyRefill(await idOf('dev:ana'), new Date('2026-10-08T12:00:00Z'))).toBe(0);
    await setBalance('dev:ana', 2000);
    expect(await service.applyDailyRefill(await idOf('dev:ana'), new Date('2026-10-09T12:00:00Z'))).toBe(0);
    expect((await ledgerOf('dev:ana')).filter((l) => l.reason === 'daily_refill')).toHaveLength(0);
  });

  it('refills again on the next UTC day: 23:59:59Z then 00:00:00Z', async () => {
    await service.ensureAccount({ devHandle: 'dev:ana' });
    await setBalance('dev:ana', 0);
    expect(await service.applyDailyRefill(await idOf('dev:ana'), new Date('2026-10-08T23:59:59Z'))).toBe(2000);
    await setBalance('dev:ana', 0);
    expect(await service.applyDailyRefill(await idOf('dev:ana'), new Date('2026-10-08T23:59:59.500Z'))).toBe(0);
    expect(await service.applyDailyRefill(await idOf('dev:ana'), new Date('2026-10-09T00:00:00Z'))).toBe(2000);
    const keys = (await ledgerOf('dev:ana'))
      .filter((l) => l.reason === 'daily_refill')
      .map((l) => l.idempotencyKey);
    expect(keys).toEqual(['refill:2026-10-08', 'refill:2026-10-09']);
    await auditChips(db.prisma);
  });

  it('concurrent refills on the same day add chips once', async () => {
    const ana = await service.ensureAccount({ devHandle: 'dev:ana' });
    await setBalance('dev:ana', 300);
    const now = new Date('2026-10-08T12:00:00Z');
    const added = await Promise.all(
      Array.from({ length: 5 }, () => service.applyDailyRefill(ana, now)),
    );
    expect(added.reduce((a, b) => a + b, 0)).toBe(1700);
    expect((await walletOf('dev:ana')).balance).toBe(2000n);
    expect((await ledgerOf('dev:ana')).filter((l) => l.reason === 'daily_refill')).toHaveLength(1);
    await auditChips(db.prisma);
  });

  it('auditChips holds after accounts and refills', async () => {
    for (const h of ['dev:a', 'dev:b', 'dev:c']) await service.ensureAccount({ devHandle: h });
    await setBalance('dev:b', 50);
    await service.applyDailyRefill(await idOf('dev:b'), new Date('2026-10-08T01:00:00Z'));
    await service.applyDailyRefill(await idOf('dev:a'), new Date('2026-10-08T01:00:00Z'));
    await auditChips(db.prisma);
  });
  it('creates a Supabase account with profiles.id = userId, wallet, initial and an automatic nickname', async () => {
    const userId = randomUUID();
    expect(await service.ensureAccount({ userId, isGuest: true })).toBe(userId);
    expect(await service.ensureAccount({ userId, isGuest: true })).toBe(userId);
    const profile = await db.prisma.profile.findUniqueOrThrow({ where: { id: userId } });
    expect(profile.devHandle).toBeNull();
    expect(profile.nickname).toMatch(/^Jugador\d{4}$/);
    expect((await db.prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(10000n);
    expect(await db.prisma.chipLedger.count({ where: { userId, reason: 'initial' } })).toBe(1);
    await auditChips(db.prisma);
  });

  it('concurrent Supabase accounts (x5) for the same user create one account', async () => {
    const userId = randomUUID();
    const ids = await Promise.all(Array.from({ length: 5 }, () => service.ensureAccount({ userId, isGuest: false })));
    expect(new Set(ids)).toEqual(new Set([userId]));
    expect(await db.prisma.chipLedger.count({ where: { userId } })).toBe(1);
    await auditChips(db.prisma);
  });

  it('two new users drawing the same automatic nickname at once end with different ones', async () => {
    const digits = [1234, 1234, 1234, 1234, 5678, 9012];
    let i = 0;
    const clashing = new AccountService(db.prisma, { ...OPTS, randomInt: () => digits[Math.min(i++, digits.length - 1)]! });
    const [a, b] = [randomUUID(), randomUUID()];
    await Promise.all([clashing.ensureAccount({ userId: a, isGuest: true }), clashing.ensureAccount({ userId: b, isGuest: true })]);
    const names = (await db.prisma.profile.findMany({ where: { id: { in: [a, b] } } })).map((p) => p.nickname);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    for (const n of names) expect(n).toMatch(/^Jugador\d{4}$/);
    expect(names).toContain('Jugador1234');
  });

  it('fails clearly when no automatic nickname is free after 20 attempts', async () => {
    const always = new AccountService(db.prisma, { ...OPTS, randomInt: () => 7 });
    await always.ensureAccount({ userId: randomUUID(), isGuest: true });
    await expect(always.ensureAccount({ userId: randomUUID(), isGuest: true })).rejects.toThrow(/nickname/i);
  });

  it('dev handle maps to a profile id; taken or invalid names get an automatic nickname', async () => {
    const ana = await service.ensureAccount({ devHandle: 'dev:ana' });
    expect(ana).toMatch(/^[0-9a-f-]{36}$/);
    expect(await service.ensureAccount({ userId: ana, isGuest: false })).toBe(ana);
    // A handle whose name is already another profile's nickname falls back to an automatic one.
    await db.prisma.profile.update({ where: { id: ana }, data: { nickname: 'pepe' } });
    const pepe = await service.ensureAccount({ devHandle: 'dev:pepe' });
    expect((await db.prisma.profile.findUniqueOrThrow({ where: { id: pepe } })).nickname).toMatch(/^Jugador\d{4}$/);
    const odd = await service.ensureAccount({ devHandle: 'dev:x' });
    expect((await db.prisma.profile.findUniqueOrThrow({ where: { id: odd } })).nickname).toMatch(/^Jugador\d{4}$/);
  });

  it('an existing live profile without nickname gets one on the next ensureAccount', async () => {
    const ana = await service.ensureAccount({ devHandle: 'dev:ana' });
    await db.prisma.profile.update({ where: { id: ana }, data: { nickname: null } });
    await service.ensureAccount({ devHandle: 'dev:ana' });
    expect((await db.prisma.profile.findUniqueOrThrow({ where: { id: ana } })).nickname).toBe('ana');
    const userId = randomUUID();
    await service.ensureAccount({ userId, isGuest: true });
    await db.prisma.profile.update({ where: { id: userId }, data: { nickname: null } });
    await service.ensureAccount({ userId, isGuest: true });
    expect((await db.prisma.profile.findUniqueOrThrow({ where: { id: userId } })).nickname).toMatch(/^Jugador\d{4}$/);
  });

  it('never resurrects a deleted profile: ensureAccount rejects it and isDeleted reports it', async () => {
    const userId = randomUUID();
    await service.ensureAccount({ userId, isGuest: true });
    const ana = await service.ensureAccount({ devHandle: 'dev:ana' });
    expect(await service.isDeleted(userId)).toBe(false);
    expect(await service.isDeleted(randomUUID())).toBe(false);
    const gone = new Date('2026-10-08T12:00:00Z');
    await db.prisma.profile.updateMany({ where: { id: { in: [userId, ana] } }, data: { deletedAt: gone, nickname: null } });
    const ledgerBefore = await db.prisma.chipLedger.count();

    expect(await service.isDeleted(userId)).toBe(true);
    await expect(service.ensureAccount({ userId, isGuest: true })).rejects.toBeInstanceOf(AccountDeletedError);
    await expect(service.ensureAccount({ devHandle: 'dev:ana' })).rejects.toBeInstanceOf(AccountDeletedError);

    expect(await db.prisma.chipLedger.count()).toBe(ledgerBefore);
    expect(await db.prisma.wallet.count({ where: { userId: { in: [userId, ana] } } })).toBe(2);
    const rows = await db.prisma.profile.findMany({ where: { id: { in: [userId, ana] } } });
    for (const r of rows) {
      expect(r.deletedAt).toEqual(gone);
      expect(r.nickname).toBeNull();
    }
  });

  it('profile and updateProfile: read, partial update, taken nickname, deleted profile', async () => {
    const ana = await service.ensureAccount({ devHandle: 'dev:ana_p' });
    await service.ensureAccount({ devHandle: 'dev:beto_p' });
    await expect(service.profile(ana)).resolves.toEqual({ nickname: 'ana_p', avatarId: null, balance: 10000 });

    await expect(service.updateProfile(ana, { avatarId: 'a03' })).resolves.toEqual({
      nickname: 'ana_p',
      avatarId: 'a03',
      balance: 10000,
    });
    await expect(service.updateProfile(ana, { nickname: 'Ana_Nueva' })).resolves.toMatchObject({
      nickname: 'Ana_Nueva',
      avatarId: 'a03',
    });
    await expect(service.updateProfile(ana, { nickname: 'beto_p' })).rejects.toBeInstanceOf(NicknameTakenError);

    await db.prisma.profile.update({ where: { id: ana }, data: { deletedAt: new Date() } });
    await expect(service.profile(ana)).resolves.toBeNull();
    await expect(service.updateProfile(ana, { avatarId: 'a01' })).resolves.toBeNull();
    await expect(service.profile(randomUUID())).resolves.toBeNull();
  });

  describe('deleteAccount', () => {
    it('empties the wallet with an account_deleted entry, anonymizes the profile, audit holds', async () => {
      const id = await service.ensureAccount({ devHandle: 'dev:gone' });
      await service.updateProfile(id, { avatarId: 'a03' });
      expect(await service.deleteAccount(id)).toBe('deleted');

      const profile = await db.prisma.profile.findUniqueOrThrow({ where: { id } });
      expect(profile).toMatchObject({ nickname: null, devHandle: null, avatarId: null, authDeletedAt: null });
      expect(profile.deletedAt).toBeInstanceOf(Date);
      expect((await db.prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).balance).toBe(0n);
      const entry = await db.prisma.chipLedger.findFirstOrThrow({ where: { userId: id, reason: 'account_deleted' } });
      expect(entry).toMatchObject({ delta: -10000n, balanceAfter: 0n });
      expect(await service.isDeleted(id)).toBe(true);
      await expect(service.ensureAccount({ userId: id, isGuest: false })).rejects.toBeInstanceOf(AccountDeletedError);
      // The dev handle is free again: a new, different account.
      expect(await service.ensureAccount({ devHandle: 'dev:gone' })).not.toBe(id);
      await auditChips(db.prisma);
    });

    it('refill after delete leaves balance 0 and writes no daily_refill row', async () => {
      const id = await service.ensureAccount({ userId: randomUUID(), isGuest: true });
      await service.deleteAccount(id);
      expect(await service.applyDailyRefill(id, new Date('2026-10-08T12:00:00Z'))).toBe(0);
      expect((await db.prisma.wallet.findUniqueOrThrow({ where: { userId: id } })).balance).toBe(0n);
      expect(await db.prisma.chipLedger.count({ where: { userId: id, reason: 'daily_refill' } })).toBe(0);
      await auditChips(db.prisma);
    });

    it('no ledger entry when the wallet is already empty', async () => {
      const id = await service.ensureAccount({ userId: randomUUID(), isGuest: true });
      await db.prisma.wallet.update({ where: { userId: id }, data: { balance: 0n } });
      await db.prisma.chipLedger.create({ data: { userId: id, delta: -10000n, balanceAfter: 0n, reason: 'account_deleted' } });
      expect(await service.deleteAccount(id)).toBe('deleted');
      expect(await db.prisma.chipLedger.count({ where: { userId: id, reason: 'account_deleted' } })).toBe(1);
    });

    it('concurrent deletions (x5) debit once', async () => {
      const id = await service.ensureAccount({ userId: randomUUID(), isGuest: false });
      const results = await Promise.all(Array.from({ length: 5 }, () => service.deleteAccount(id)));
      expect(results.filter((r) => r === 'deleted')).toHaveLength(1);
      expect(results.filter((r) => r === 'already')).toHaveLength(4);
      expect(await db.prisma.chipLedger.count({ where: { userId: id, reason: 'account_deleted' } })).toBe(1);
      await auditChips(db.prisma);
    });

    it('refuses (AccountBusyError) while a seat still holds chips; nothing changes', async () => {
      await service.ensureAccount({ devHandle: 'dev:sat' });
      await setBalance('dev:sat', 4000);
      const id = await idOf('dev:sat');
      await expect(service.deleteAccount(id)).rejects.toBeInstanceOf(AccountBusyError);
      expect(await service.isDeleted(id)).toBe(false);
      expect((await walletOf('dev:sat')).balance).toBe(4000n);
      await auditChips(db.prisma);
    });

    it('unknown ids are "already" (nothing to delete)', async () => {
      expect(await service.deleteAccount(randomUUID())).toBe('already');
    });

    it('tracks the Supabase Auth deletion: pending until marked', async () => {
      const a = await service.ensureAccount({ userId: randomUUID(), isGuest: true });
      const b = await service.ensureAccount({ userId: randomUUID(), isGuest: true });
      await service.ensureAccount({ userId: randomUUID(), isGuest: true });
      await service.deleteAccount(a);
      await service.deleteAccount(b);
      expect((await service.pendingAuthDeletions()).sort()).toEqual([a, b].sort());
      await service.markAuthDeleted(a);
      expect(await service.pendingAuthDeletions()).toEqual([b]);
    });
  });
});
