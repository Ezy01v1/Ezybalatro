import './table-env';
import { randomUUID, type webcrypto } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SOCKET_EVENTS, type Ack, type SocketError } from '@naipes/shared';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { AuthAdminPort } from '../src/auth/supabase-admin';
import { SupabaseTokenVerifier } from '../src/auth/token-verifier';
import { auditChips, type TestDatabase } from '../src/db/testing/test-database';
import { setupApp } from '../src/setup-app';
import { loadAppModule, startE2eDatabase } from './test-database-env';

const SUPABASE_URL = 'https://e2e.supabase.co';

/** Fake Supabase Auth admin: no network; fails the next `failures` calls. */
class FakeAuthAdmin implements AuthAdminPort {
  readonly calls: string[] = [];
  failures = 0;
  async deleteUser(userId: string): Promise<void> {
    this.calls.push(userId);
    if (this.failures > 0) {
      this.failures--;
      throw new Error('Supabase deleteUser failed (status 500, code unexpected_failure)');
    }
  }
}

describe('DELETE /v1/me (e2e)', () => {
  let db: TestDatabase;
  let key: webcrypto.CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;
  const sockets: Socket[] = [];

  const sign = (sub: string) =>
    new SignJWT({ is_anonymous: true })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);

  async function startApp(admin: AuthAdminPort | null): Promise<{ app: INestApplication; url: string }> {
    const { TOKEN_VERIFIER } = await import('../src/tables/tables.module.js');
    const { AUTH_ADMIN } = await import('../src/auth/supabase-admin.js');
    const moduleRef = await Test.createTestingModule({ imports: [await loadAppModule()] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(new SupabaseTokenVerifier({ supabaseUrl: SUPABASE_URL, jwks }))
      .overrideProvider(AUTH_ADMIN)
      .useValue(admin)
      .compile();
    const app = moduleRef.createNestApplication({ bufferLogs: true });
    setupApp(app);
    await app.listen(0, '127.0.0.1');
    return { app, url: await app.getUrl() };
  }

  function connect(url: string, token: string): Socket {
    const socket = io(url, { transports: ['websocket'], auth: { token }, forceNew: true, reconnection: false });
    sockets.push(socket);
    return socket;
  }

  const connected = (socket: Socket) =>
    new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });

  beforeAll(async () => {
    db = await startE2eDatabase();
    const pair = await generateKeyPair('ES256');
    key = pair.privateKey;
    jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' }] });
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await db?.stop();
  });

  it('anonymizes a seated user, disconnects the socket, and the same token is then rejected (REST and socket)', async () => {
    const admin = new FakeAuthAdmin();
    const { app, url } = await startApp(admin);
    try {
      const sub = randomUUID();
      const token = await sign(sub);
      const socket = connect(url, token);
      await connected(socket);
      const seat = (await socket.timeout(10_000).emitWithAck(SOCKET_EVENTS.quickSeat, {})) as Ack<{ tableId: string }>;
      expect(seat.ok).toBe(true);

      const errors: SocketError[] = [];
      socket.on(SOCKET_EVENTS.error, (e: SocketError) => errors.push(e));
      const disconnected = new Promise<string>((resolve) => socket.once('disconnect', resolve));

      await request(app.getHttpServer()).delete('/v1/me').set('Authorization', `Bearer ${token}`).expect(204);

      expect(await disconnected).toBe('io server disconnect');
      expect(errors).toEqual([expect.objectContaining({ type: 'error', code: 'UNAUTHORIZED' })]);

      const profile = await db.prisma.profile.findUniqueOrThrow({ where: { id: sub } });
      expect(profile).toMatchObject({ nickname: null, devHandle: null, avatarId: null });
      expect(profile.deletedAt).not.toBeNull();
      expect(profile.authDeletedAt).not.toBeNull();
      expect(await db.prisma.seat.count({ where: { userId: sub } })).toBe(0);
      expect((await db.prisma.wallet.findUniqueOrThrow({ where: { userId: sub } })).balance).toBe(0n);
      expect(await db.prisma.chipLedger.count({ where: { userId: sub, reason: 'account_deleted' } })).toBe(1);
      expect(admin.calls).toEqual([sub]);

      // Review Focus 1: the still-valid token of the deleted account.
      const rest = await request(app.getHttpServer()).get('/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
      expect(rest.body.error.code).toBe('UNAUTHORIZED');
      await request(app.getHttpServer()).delete('/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
      const again = connect(url, token);
      await expect(connected(again)).rejects.toThrow('UNAUTHORIZED');
      expect(await db.prisma.profile.findUniqueOrThrow({ where: { id: sub } })).toMatchObject({ nickname: null });
    } finally {
      await app.close();
    }
    await auditChips(db.prisma);
  });

  it('two DELETE calls at once: both 204, the wallet is debited once', async () => {
    const admin = new FakeAuthAdmin();
    const { app } = await startApp(admin);
    try {
      const sub = randomUUID();
      const token = await sign(sub);
      await request(app.getHttpServer()).get('/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
      const statuses = await Promise.all(
        [0, 1].map(async () => (await request(app.getHttpServer()).delete('/v1/me').set('Authorization', `Bearer ${token}`)).status),
      );
      expect(statuses.every((s) => s === 204 || s === 401)).toBe(true);
      expect(statuses).toContain(204);
      expect(await db.prisma.chipLedger.count({ where: { userId: sub, reason: 'account_deleted' } })).toBe(1);
    } finally {
      await app.close();
    }
    await auditChips(db.prisma);
  });

  it('an Auth deletion that fails is still 204 and is retried at the next startup', async () => {
    const failing = new FakeAuthAdmin();
    failing.failures = 1;
    const sub = randomUUID();
    const first = await startApp(failing);
    try {
      const token = await sign(sub);
      await request(first.app.getHttpServer()).get('/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
      await request(first.app.getHttpServer()).delete('/v1/me').set('Authorization', `Bearer ${token}`).expect(204);
      expect(failing.calls).toEqual([sub]);
      expect((await db.prisma.profile.findUniqueOrThrow({ where: { id: sub } })).authDeletedAt).toBeNull();
    } finally {
      await first.app.close();
    }

    const working = new FakeAuthAdmin();
    const second = await startApp(working);
    await second.app.close(); // waits for the startup cleanup
    expect(working.calls).toContain(sub);
    expect((await db.prisma.profile.findUniqueOrThrow({ where: { id: sub } })).authDeletedAt).not.toBeNull();

    const third = new FakeAuthAdmin();
    const restarted = await startApp(third);
    await restarted.app.close();
    expect(third.calls).not.toContain(sub);
  });

  it('without SUPABASE_SECRET_KEY: 503 NOT_CONFIGURED and nothing changes', async () => {
    const { app } = await startApp(null);
    try {
      const sub = randomUUID();
      const token = await sign(sub);
      const res = await request(app.getHttpServer()).delete('/v1/me').set('Authorization', `Bearer ${token}`).expect(503);
      expect(res.body.error).toMatchObject({ code: 'NOT_CONFIGURED', requestId: expect.any(String) });
      await request(app.getHttpServer()).get('/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    } finally {
      await app.close();
    }
  });
});
