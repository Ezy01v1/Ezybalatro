import { createClient } from '@supabase/supabase-js';
import type { AccountDeletionPort } from '../accounts/account-port';

/** Injection token of the `AuthAdminPort` (null when `SUPABASE_SECRET_KEY` is not set). */
export const AUTH_ADMIN = Symbol('AUTH_ADMIN');

/** Supabase Auth administration (server only, with the secret key). */
export interface AuthAdminPort {
  /** Deletes the Auth user; resolves when it is gone (a user that does not exist counts as gone). */
  deleteUser(userId: string): Promise<void>;
}

/**
 * `AuthAdminPort` over `@supabase/supabase-js` (`auth.admin.deleteUser`). The secret key never
 * reaches a log or an error message: failures only carry the HTTP status and error code.
 */
export class SupabaseAuthAdmin implements AuthAdminPort {
  private readonly client: ReturnType<typeof createClient>;

  constructor(supabaseUrl: string, secretKey: string) {
    this.client = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.client.auth.admin.deleteUser(userId);
    if (!error) return;
    const status = (error as { status?: number }).status;
    const code = (error as { code?: string }).code;
    if (status === 404 || code === 'user_not_found') return;
    throw new Error(`Supabase deleteUser failed (status ${status ?? 'unknown'}, code ${code ?? 'unknown'})`);
  }
}

interface CleanupLogger {
  log(message: string): void;
  warn(message: string): void;
}

/**
 * Startup retry (spec §5.3): every deleted profile whose Auth user is not known to be gone
 * (`auth_deleted_at` NULL) gets `deleteUser` again; success (or "not found") marks it done, so it is
 * never retried after that. Best-effort: a failure is logged and left for the next startup.
 */
export async function retryAuthDeletions(
  accounts: Pick<AccountDeletionPort, 'pendingAuthDeletions' | 'markAuthDeleted'>,
  admin: AuthAdminPort,
  logger: CleanupLogger,
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const userId of await accounts.pendingAuthDeletions()) {
    try {
      await admin.deleteUser(userId);
      await accounts.markAuthDeleted(userId);
      deleted++;
    } catch (error) {
      failed++;
      const detail = error instanceof Error ? error.message : 'non-Error thrown';
      logger.warn(`Auth cleanup: deleting Auth user ${userId} failed (${detail}); retried at next startup`);
    }
  }
  if (deleted + failed > 0) logger.log(`Auth cleanup: ${deleted} Auth user(s) deleted, ${failed} left`);
  return { deleted, failed };
}
