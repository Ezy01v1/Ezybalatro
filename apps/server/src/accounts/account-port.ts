/** Injection token of the `AccountPort` (Nest). */
export const ACCOUNTS = Symbol('ACCOUNTS');

/** Who an account is for: a Supabase user (`profiles.id = sub`) or a development handle (`dev:<name>`). */
export type AccountKey = { userId: string; isGuest: boolean } | { devHandle: string };

/** What the gateway needs from the accounts: make sure the account exists, then the daily refill. */
export interface AccountPort {
  /**
   * Creates the account (profile + wallet with the initial chips) if missing and makes sure it has a
   * nickname; idempotent. Returns the `profiles.id`. Rejects with `AccountDeletedError` when the
   * profile exists but was deleted: it is never resurrected (no new wallet, no `initial`).
   */
  ensureAccount(key: AccountKey): Promise<string>;
  /** True when the `profiles.id` exists and has `deleted_at` (unknown ids are not deleted). */
  isDeleted(userId: string): Promise<boolean>;
  /** Chips added by the daily refill of the `profiles.id` (0 when none). */
  applyDailyRefill(userId: string, now: Date): Promise<number>;
}

/** `ensureAccount` on a profile with `deleted_at`: the caller must reject the identity. */
export class AccountDeletedError extends Error {
  constructor() {
    super('Account deleted');
    this.name = 'AccountDeletedError';
  }
}

/** Public profile data of a live account (REST `/v1/me`). */
export interface Profile {
  nickname: string;
  avatarId: string | null;
  balance: number;
}

/** What `/v1/me` needs from the accounts. */
export interface ProfilePort {
  /** The live profile with its wallet balance; null when missing or deleted. */
  profile(userId: string): Promise<Profile | null>;
  /**
   * Sets the given fields of a live profile and returns it (null when missing or deleted). Rejects
   * with `NicknameTakenError` when another live profile has the nickname.
   */
  updateProfile(userId: string, changes: { nickname?: string; avatarId?: string }): Promise<Profile | null>;
}

/** The nickname belongs to another live profile. */
export class NicknameTakenError extends Error {
  constructor() {
    super('Nickname taken');
    this.name = 'NicknameTakenError';
  }
}

/** What `DELETE /v1/me` and the startup cleanup need from the accounts (spec §5). */
export interface AccountDeletionPort {
  /**
   * In one transaction: wallet to 0 with an `account_deleted` ledger entry (when > 0) and the profile
   * anonymized (`nickname`, `dev_handle`, `avatar_id` NULL, `deleted_at` now). `already` when it was
   * deleted before (or never existed): concurrent calls debit once. Rejects with `AccountBusyError`
   * while a seat of the user is still in the database (chips on a table).
   */
  deleteAccount(userId: string): Promise<'deleted' | 'already'>;
  /** Deleted profiles whose Supabase Auth user is not known to be deleted yet. */
  pendingAuthDeletions(): Promise<string[]>;
  /** Records that the Supabase Auth user of a deleted profile is gone. */
  markAuthDeleted(userId: string): Promise<void>;
}

/** The user still has a seat (chips on a table): the deletion must be retried. */
export class AccountBusyError extends Error {
  constructor() {
    super('Account busy');
    this.name = 'AccountBusyError';
  }
}
