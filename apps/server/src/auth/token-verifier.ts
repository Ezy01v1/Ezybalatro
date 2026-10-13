import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** What the table socket / REST need from a verified Supabase access token. */
export interface VerifiedToken {
  sub: string;
  isAnonymous: boolean;
}

export interface TokenVerifierOptions {
  /** e.g. `https://<ref>.supabase.co` (a trailing slash is ignored). */
  supabaseUrl: string;
  /** Key set override (tests: `createLocalJWKSet`). Default: the project's remote JWKS. */
  jwks?: JWTVerifyGetKey;
  /** HTTP timeout of the remote JWKS fetch; capped at 5 s. */
  jwksTimeoutMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_JWKS_TIMEOUT_MS = 5000;

/**
 * Verifies Supabase access tokens locally (asymmetric signing keys, JWKS cached by jose with a
 * cooldown between refetches). Required: iss `<url>/auth/v1`, aud `authenticated`, exp, uuid sub.
 * `verify` resolves null on ANY failure, never throws and never logs the token.
 */
export class SupabaseTokenVerifier {
  private readonly issuer: string;
  private readonly jwks: JWTVerifyGetKey;

  constructor(opts: TokenVerifierOptions) {
    const base = opts.supabaseUrl.replace(/\/+$/, '');
    this.issuer = `${base}/auth/v1`;
    this.jwks =
      opts.jwks ??
      createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`), {
        timeoutDuration: Math.min(opts.jwksTimeoutMs ?? MAX_JWKS_TIMEOUT_MS, MAX_JWKS_TIMEOUT_MS),
        cooldownDuration: 30_000,
      });
  }

  async verify(token: string): Promise<VerifiedToken | null> {
    try {
      if (typeof token !== 'string' || token === '') return null;
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'authenticated',
        requiredClaims: ['exp', 'sub'],
        algorithms: ['ES256', 'RS256'],
      });
      if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) return null;
      return { sub: payload.sub.toLowerCase(), isAnonymous: payload.is_anonymous === true };
    } catch {
      return null;
    }
  }
}
