import type { Env } from '../config/env';

/** Injection token of the `IdentityPort`. */
export const IDENTITY = Symbol('IDENTITY');

export interface Identity {
  userId: string;
  displayName: string;
}

/** Authenticates a Socket.IO handshake (`socket.handshake.auth`); null rejects it (spec §6.4). */
export interface IdentityPort {
  authenticate(auth: unknown): Promise<Identity | null>;
}

const DEV_TOKEN = /^dev:([A-Za-z0-9_]{3,20})$/;

/**
 * Phase 3a identity: `{ token: 'dev:<name>' }` with a 3–20 character `[A-Za-z0-9_]` name, so anybody
 * can be anybody. Never accepted in production (there is no way in until Phase 3c).
 */
export class DevIdentity implements IdentityPort {
  constructor(private readonly nodeEnv: Env['NODE_ENV']) {}

  async authenticate(auth: unknown): Promise<Identity | null> {
    if (this.nodeEnv === 'production') return null;
    if (typeof auth !== 'object' || auth === null) return null;
    const token = (auth as { token?: unknown }).token;
    if (typeof token !== 'string') return null;
    const match = DEV_TOKEN.exec(token);
    if (!match) return null;
    return { userId: token, displayName: match[1]! };
  }
}
