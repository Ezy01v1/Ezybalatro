import { AccountDeletedError, type AccountPort } from '../accounts/account-port';
import type { VerifiedToken } from '../auth/token-verifier';
import type { Env } from '../config/env';

/** Injection token of the `IdentityPort`. */
export const IDENTITY = Symbol('IDENTITY');

/** An authenticated user: `userId` is the `profiles.id`. */
export interface Identity {
  userId: string;
  isGuest: boolean;
}

/** Authenticates a Socket.IO handshake (`socket.handshake.auth`); null rejects it (spec §6.4). */
export interface IdentityPort {
  authenticate(auth: unknown): Promise<Identity | null>;
}

const DEV_TOKEN = /^dev:([A-Za-z0-9_]{3,20})$/;

/**
 * Development identity: `{ token: 'dev:<name>' }` with a 3–20 character `[A-Za-z0-9_]` name, so
 * anybody can be anybody. The handle is mapped to its `profiles.id` (the account is created on first
 * use). Never accepted in production; only wired in with `DEV_IDENTITY=true` (`createIdentity`).
 */
export class DevIdentity implements IdentityPort {
  constructor(
    private readonly nodeEnv: Env['NODE_ENV'],
    private readonly accounts: Pick<AccountPort, 'ensureAccount'>,
  ) {}

  async authenticate(auth: unknown): Promise<Identity | null> {
    if (this.nodeEnv === 'production') return null;
    if (typeof auth !== 'object' || auth === null) return null;
    const token = (auth as { token?: unknown }).token;
    if (typeof token !== 'string' || !DEV_TOKEN.test(token)) return null;
    const userId = await this.accounts.ensureAccount({ devHandle: token });
    return { userId, isGuest: false };
  }
}

/** The handshake's `token` when it is a non-empty string. */
function tokenOf(auth: unknown): string | null {
  if (typeof auth !== 'object' || auth === null) return null;
  const token = (auth as { token?: unknown }).token;
  return typeof token === 'string' && token !== '' ? token : null;
}

/**
 * Supabase identity: `{ token: <access token> }` verified locally (`SupabaseTokenVerifier`);
 * `profiles.id = sub`, `is_anonymous` → guest. Deleted profiles are rejected and never recreated.
 */
export class SupabaseIdentity implements IdentityPort {
  constructor(
    private readonly verifier: { verify(token: string): Promise<VerifiedToken | null> },
    private readonly accounts: Pick<AccountPort, 'ensureAccount' | 'isDeleted'>,
  ) {}

  async authenticate(auth: unknown): Promise<Identity | null> {
    const token = tokenOf(auth);
    if (token === null) return null;
    const verified = await this.verifier.verify(token);
    if (!verified) return null;
    if (await this.accounts.isDeleted(verified.sub)) return null;
    try {
      const userId = await this.accounts.ensureAccount({ userId: verified.sub, isGuest: verified.isAnonymous });
      return { userId, isGuest: verified.isAnonymous };
    } catch (error) {
      if (error instanceof AccountDeletedError) return null;
      throw error;
    }
  }
}

/**
 * The socket's identity: `dev:` tokens go to `DevIdentity` only with `DEV_IDENTITY=true` outside
 * production (and are never sent to the verifier); anything else is a Supabase access token
 * (rejected when there is no verifier, i.e. no `SUPABASE_URL`).
 */
export function createIdentity(
  env: Pick<Env, 'NODE_ENV' | 'DEV_IDENTITY'>,
  accounts: Pick<AccountPort, 'ensureAccount' | 'isDeleted'>,
  verifier: { verify(token: string): Promise<VerifiedToken | null> } | null,
): IdentityPort {
  const dev = env.DEV_IDENTITY && env.NODE_ENV !== 'production' ? new DevIdentity(env.NODE_ENV, accounts) : null;
  const supabase = verifier ? new SupabaseIdentity(verifier, accounts) : null;
  return {
    authenticate: async (auth) => {
      const token = tokenOf(auth);
      if (token === null) return null;
      if (token.startsWith('dev:')) return dev ? dev.authenticate(auth) : null;
      return supabase ? supabase.authenticate(auth) : null;
    },
  };
}
