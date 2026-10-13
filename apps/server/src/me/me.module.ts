import {
  Inject,
  Logger,
  Module,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ACCOUNTS, type AccountDeletionPort } from '../accounts/account-port';
import { AUTH_ADMIN, SupabaseAuthAdmin, retryAuthDeletions, type AuthAdminPort } from '../auth/supabase-admin';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { Env } from '../config/env';
import { TablesModule } from '../tables/tables.module';
import { MeController } from './me.controller';

/**
 * REST `/v1/me` (spec §4) and the Supabase Auth admin (null without `SUPABASE_URL` and
 * `SUPABASE_SECRET_KEY`). At startup, Auth users of deleted profiles still pending are deleted again
 * in the background (best-effort: never blocks or fails the boot).
 */
@Module({
  imports: [TablesModule],
  controllers: [MeController],
  providers: [
    SupabaseAuthGuard,
    {
      provide: AUTH_ADMIN,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): AuthAdminPort | null => {
        const url = config.get('SUPABASE_URL', { infer: true });
        const secret = config.get('SUPABASE_SECRET_KEY', { infer: true });
        return url && secret ? new SupabaseAuthAdmin(url, secret) : null;
      },
    },
  ],
})
export class MeModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AuthCleanup');
  private cleanup: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(ACCOUNTS) private readonly accounts: AccountDeletionPort,
    @Optional() @Inject(AUTH_ADMIN) private readonly authAdmin: AuthAdminPort | null,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.authAdmin) return;
    this.cleanup = retryAuthDeletions(this.accounts, this.authAdmin, this.logger).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'non-Error thrown';
      this.logger.warn(`Auth cleanup failed (${detail}); retried at next startup`);
    });
  }

  /** Lets a cleanup still running finish before the database closes. */
  async onApplicationShutdown(): Promise<void> {
    await this.cleanup;
  }
}
