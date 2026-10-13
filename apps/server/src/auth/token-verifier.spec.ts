import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac, randomUUID, type webcrypto } from 'node:crypto';

type CryptoKey = webcrypto.CryptoKey;
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';
import { SupabaseTokenVerifier } from './token-verifier';

const URL_ = 'https://proj.supabase.co';
const ISS = `${URL_}/auth/v1`;

describe('SupabaseTokenVerifier', () => {
  let key: CryptoKey;
  let otherKey: CryptoKey;
  let jwks: JWTVerifyGetKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    key = pair.privateKey;
    otherKey = (await generateKeyPair('ES256')).privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' };
    jwks = createLocalJWKSet({ keys: [jwk] });
  });

  const sign = (claims: Record<string, unknown> = {}, opts: { iss?: string; aud?: string; exp?: number | string; sub?: string; signer?: CryptoKey } = {}) => {
    const jwt = new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(opts.iss ?? ISS)
      .setAudience(opts.aud ?? 'authenticated')
      .setSubject(opts.sub ?? randomUUID())
      .setIssuedAt();
    if (opts.exp !== undefined) jwt.setExpirationTime(opts.exp);
    else jwt.setExpirationTime('1h');
    return jwt.sign(opts.signer ?? key);
  };

  it('accepts a valid token and maps is_anonymous', async () => {
    const v = new SupabaseTokenVerifier({ supabaseUrl: URL_, jwks });
    const sub = randomUUID();
    await expect(v.verify(await sign({}, { sub }))).resolves.toEqual({ sub, isAnonymous: false });
    await expect(v.verify(await sign({ is_anonymous: true }, { sub }))).resolves.toEqual({ sub, isAnonymous: true });
  });

  it('tolerates a trailing slash in the Supabase URL', async () => {
    const v = new SupabaseTokenVerifier({ supabaseUrl: `${URL_}/`, jwks });
    await expect(v.verify(await sign())).resolves.not.toBeNull();
  });

  it('returns null for expired, wrong iss/aud, bad signature, non-uuid sub, missing exp and garbage', async () => {
    const v = new SupabaseTokenVerifier({ supabaseUrl: URL_, jwks });
    const noExp = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(ISS).setAudience('authenticated').setSubject(randomUUID()).sign(key);
    for (const token of [
      await sign({}, { exp: Math.floor(Date.now() / 1000) - 60 }),
      await sign({}, { iss: 'https://other.supabase.co/auth/v1' }),
      await sign({}, { aud: 'anon' }),
      await sign({}, { signer: otherKey }),
      await sign({}, { sub: 'not-a-uuid' }),
      noExp,
      'garbage',
      '',
    ]) {
      await expect(v.verify(token)).resolves.toBeNull();
    }
  });

  describe('algorithm and key confusion', () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const claims = () => ({
      iss: ISS,
      aud: 'authenticated',
      sub: randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const signed = (kid: string, aud: string | string[]) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer(ISS)
        .setAudience(aud)
        .setSubject(randomUUID())
        .setExpirationTime('1h')
        .sign(key);

    it('rejects alg none', async () => {
      const v = new SupabaseTokenVerifier({ supabaseUrl: URL_, jwks });
      const token = `${b64({ alg: 'none', typ: 'JWT', kid: 'k1' })}.${b64(claims())}.`;
      await expect(v.verify(token)).resolves.toBeNull();
    });

    it('rejects HS256 signed with the public key material', async () => {
      const v = new SupabaseTokenVerifier({ supabaseUrl: URL_, jwks });
      const header = b64({ alg: 'HS256', typ: 'JWT', kid: 'k1' });
      const body = b64(claims());
      const secret = JSON.stringify(await exportJWK((await generateKeyPair('ES256')).publicKey));
      const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
      await expect(v.verify(`${header}.${body}.${sig}`)).resolves.toBeNull();
    });

    it('rejects an unknown kid', async () => {
      const v = new SupabaseTokenVerifier({ supabaseUrl: URL_, jwks });
      await expect(v.verify(await signed('unknown', 'authenticated'))).resolves.toBeNull();
    });

    it('rejects an aud array without authenticated', async () => {
      const v = new SupabaseTokenVerifier({ supabaseUrl: URL_, jwks });
      await expect(v.verify(await signed('k1', ['anon', 'service']))).resolves.toBeNull();
    });
  });

  it('returns null (never throws) when the JWKS fails', async () => {
    const failing: JWTVerifyGetKey = () => Promise.reject(new Error('down'));
    const v = new SupabaseTokenVerifier({ supabaseUrl: URL_, jwks: failing });
    await expect(v.verify(await sign())).resolves.toBeNull();
  });

  describe('remote JWKS', () => {
    let server: Server;
    beforeAll(async () => {
      server = createServer(() => { /* never answers */ });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    });
    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    });

    it('returns null when the JWKS endpoint times out', async () => {
      const { port } = server.address() as AddressInfo;
      const v = new SupabaseTokenVerifier({ supabaseUrl: `http://127.0.0.1:${port}`, jwksTimeoutMs: 200 });
      const start = Date.now();
      await expect(v.verify(await sign())).resolves.toBeNull();
      expect(Date.now() - start).toBeLessThan(3000);
    });
  });
});
