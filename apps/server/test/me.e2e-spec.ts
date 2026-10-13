import { randomUUID, type webcrypto } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SOCKET_EVENTS, type Ack, type TableUpdate } from '@naipes/shared';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { SupabaseTokenVerifier } from '../src/auth/token-verifier';
import type { TestDatabase } from '../src/db/testing/test-database';
import { setupApp } from '../src/setup-app';
import { loadAppModule, startE2eDatabase } from './test-database-env';

const SUPABASE_URL = 'https://e2e.supabase.co';

describe('REST /v1/me (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let db: TestDatabase;
  let key: webcrypto.CryptoKey;
  let otherKey: webcrypto.CryptoKey;
  const sockets: Socket[] = [];

  const sign = (sub: string, opts: { anonymous?: boolean; signer?: webcrypto.CryptoKey } = {}) =>
    new SignJWT({ is_anonymous: opts.anonymous ?? false })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(opts.signer ?? key);

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = await startE2eDatabase();
    const pair = await generateKeyPair('ES256');
    key = pair.privateKey;
    otherKey = (await generateKeyPair('ES256')).privateKey;
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' }] });
    const { TOKEN_VERIFIER } = await import('../src/tables/tables.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [await loadAppModule()] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(new SupabaseTokenVerifier({ supabaseUrl: SUPABASE_URL, jwks }))
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    setupApp(app);
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await app?.close();
    await db?.stop();
  });

  it('GET creates the account on first contact: automatic nickname, 10000 chips, not seated', async () => {
    const sub = randomUUID();
    const res = await http().get('/v1/me').set('Authorization', `Bearer ${await sign(sub, { anonymous: true })}`).expect(200);
    expect(res.body).toEqual({
      id: sub,
      nickname: expect.stringMatching(/^Jugador\d{4}$/),
      avatarId: null,
      isGuest: true,
      balance: 10000,
      seatedAt: null,
    });
  });

  it('PATCH updates nickname and avatar; a taken nickname is 409 NICKNAME_TAKEN', async () => {
    const a = await sign(randomUUID());
    const b = await sign(randomUUID());
    const patched = await http()
      .patch('/v1/me')
      .set('Authorization', `Bearer ${a}`)
      .send({ nickname: 'Ana_E2e', avatarId: 'a05' })
      .expect(200);
    expect(patched.body).toMatchObject({ nickname: 'Ana_E2e', avatarId: 'a05', isGuest: false });
    await http().get('/v1/me').set('Authorization', `Bearer ${a}`).expect(200).expect((r) => {
      expect(r.body).toMatchObject({ nickname: 'Ana_E2e', avatarId: 'a05' });
    });

    const taken = await http().patch('/v1/me').set('Authorization', `Bearer ${b}`).send({ nickname: 'Ana_E2e' }).expect(409);
    expect(taken.body).toEqual({
      error: { code: 'NICKNAME_TAKEN', message: expect.any(String), requestId: expect.any(String) },
    });
  });

  it.each([
    ['empty body', {}],
    ['bad nickname', { nickname: 'a b' }],
    ['unknown avatar', { avatarId: 'a99' }],
    ['unknown key', { nickname: 'Valid_1', balance: 1 }],
  ])('PATCH with %s -> 400 INVALID_REQUEST', async (_, body) => {
    const res = await http().patch('/v1/me').set('Authorization', `Bearer ${await sign(randomUUID())}`).send(body).expect(400);
    expect(res.body.error).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('missing, malformed, foreign-signed or deleted-account tokens -> 401 UNAUTHORIZED', async () => {
    const expect401 = async (auth?: string) => {
      const req = http().get('/v1/me');
      if (auth !== undefined) req.set('Authorization', auth);
      const res = await req.expect(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: expect.any(String), requestId: expect.any(String) },
      });
    };
    await expect401();
    await expect401('Bearer');
    await expect401('Basic abc');
    await expect401('Bearer not-a-jwt');
    await expect401(`Bearer ${await sign(randomUUID(), { signer: otherKey })}`);

    const sub = randomUUID();
    const token = await sign(sub);
    await http().get('/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    await db.prisma.profile.update({ where: { id: sub }, data: { deletedAt: new Date() } });
    await expect401(`Bearer ${token}`);
  });

  it('accepts Bearer dev:<name> (DEV_IDENTITY=true) with the same rules as the socket', async () => {
    const res = await http().get('/v1/me').set('Authorization', 'Bearer dev:rest_dev').expect(200);
    expect(res.body).toMatchObject({ nickname: 'rest_dev', isGuest: false });
  });

  it('x-request-id: a valid one is echoed, a malicious one is replaced by a uuid', async () => {
    const valid = await http().get('/v1/me').set('x-request-id', 'abc-123').expect(401);
    expect(valid.headers['x-request-id']).toBe('abc-123');
    expect(valid.body.error.requestId).toBe('abc-123');

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const bad of ['x'.repeat(65), 'a b', 'abc;rm', 'ab\tcd']) {
      const res = await http().get('/v1/me').set('x-request-id', bad).expect(401);
      expect(res.headers['x-request-id']).toMatch(UUID);
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    }
    const ok = await http().get('/health').expect(200);
    expect(ok.headers['x-request-id']).toMatch(UUID);
  });

  it('logs requests as JSON with the request id, never the bearer token', async () => {
    const token = await sign(randomUUID());
    const lines: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    try {
      await http().get('/v1/me').set('Authorization', `Bearer ${token}`).set('x-request-id', 'log-check-1').expect(200);
      await http().get('/v1/me').set('Authorization', `Bearer ${token}x`).expect(401);
    } finally {
      spy.mockRestore();
    }
    const output = lines.join('');
    expect(output).toContain('log-check-1');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain(token);
    expect(output).not.toContain('Bearer');
  });

  it('helmet headers and Swagger at /docs', async () => {
    const health = await http().get('/health').expect(200);
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-powered-by']).toBeUndefined();
    await http().get('/docs').expect(200);
    const doc = await http().get('/docs-json').expect(200);
    expect(Object.keys(doc.body.paths)).toContain('/v1/me');
    expect(doc.body.paths['/v1/me'].patch.responses).toHaveProperty('409');
  });

  it('table:update carries names; a PATCHed nickname shows at the table; GET reports the seat', async () => {
    const socket = io(url, { transports: ['websocket'], auth: { token: 'dev:names_a' }, forceNew: true });
    sockets.push(socket);
    const updates: TableUpdate[] = [];
    socket.on(SOCKET_EVENTS.tableUpdate, (u: TableUpdate) => updates.push(u));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    const seat = (await socket.timeout(10_000).emitWithAck(SOCKET_EVENTS.quickSeat, {})) as Ack<{ tableId: string; seat: number }>;
    if (!seat.ok) throw new Error(seat.error.code);

    const me = await http().get('/v1/me').set('Authorization', 'Bearer dev:names_a').expect(200);
    expect(me.body.seatedAt).toEqual({ tableId: seat.tableId, seat: seat.seat });
    const userId: string = me.body.id;

    const deadline = Date.now() + 10_000;
    while (!updates.some((u) => Object.keys(u.names).some((id) => id.startsWith('bot:'))) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const withBot = updates.findLast((u) => Object.keys(u.names).some((id) => id.startsWith('bot:')))!;
    expect(withBot.names[userId]).toBe('names_a');
    for (const [id, name] of Object.entries(withBot.names)) {
      if (id.startsWith('bot:')) expect(name).toBe(id.slice(4));
    }

    await http().patch('/v1/me').set('Authorization', 'Bearer dev:names_a').send({ nickname: 'Nuevo_A' }).expect(200);
    const sync = (await socket.timeout(5000).emitWithAck(SOCKET_EVENTS.sync, { tableId: seat.tableId })) as Ack<{
      update: TableUpdate;
    }>;
    if (!sync.ok) throw new Error(sync.error.code);
    expect(sync.update.names[userId]).toBe('Nuevo_A');
  });
});
