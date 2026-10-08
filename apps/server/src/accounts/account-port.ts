/** Injection token of the `AccountPort` (Nest). */
export const ACCOUNTS = Symbol('ACCOUNTS');

/** What the gateway needs from the accounts: make sure the account exists, then the daily refill. */
export interface AccountPort {
  /** Creates the account (profile + wallet with the initial chips) if missing; idempotent. */
  ensureAccount(devHandle: string): Promise<string | void>;
  /** Chips added by the daily refill (0 when none). */
  applyDailyRefill(devHandle: string, now: Date): Promise<number>;
}
