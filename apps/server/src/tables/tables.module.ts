import { randomInt, randomUUID } from 'node:crypto';
import {
  Logger,
  Module,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Rng } from '@naipes/engine';
import { envSchema, type Env } from '../config/env';
import { ACCOUNTS, type AccountPort } from '../accounts/account-port';
import { AccountService } from '../accounts/account.service';
import { DATABASE_URL, PrismaService } from '../db/prisma.service';
import { InstanceLock } from '../recovery/instance-lock';
import { RecoveryRunner } from '../recovery/recovery-runner';
import { RecoveryService } from '../recovery/recovery.service';
import { SupabaseTokenVerifier, type VerifiedToken } from '../auth/token-verifier';
import { NICKNAMES, NicknameDirectory } from '../accounts/nickname-directory';
import { IDENTITY, createIdentity, type IdentityPort } from '../realtime/identity';
import { TableGateway } from '../realtime/table.gateway';
import { CryptoDeckSource } from './crypto-deck-source';
import { PrismaTableStore } from './prisma-table-store';
import { realScheduler } from './real-scheduler';
import { TableDirector } from './table-director';
import { TABLE_SETTINGS, tableSettingsFromEnv, type TableSettings } from './table-settings';

/** The validated environment, read back key by key from the `ConfigService`. */
function envFrom(config: ConfigService<Env, true>): Env {
  const keys = Object.keys(envSchema.shape) as (keyof Env)[];
  return Object.fromEntries(keys.map((key) => [key, config.get(key, { infer: true })])) as Env;
}

/** Bot decisions and names: no need for a CSPRNG, but no seeded stream either. */
const botRng: Rng = { nextUint32: () => randomInt(0, 2 ** 32) };

/** Injection token of the access-token verifier (null without `SUPABASE_URL`); tests override it. */
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

type TokenVerifier = { verify(token: string): Promise<VerifiedToken | null> };

/**
 * Tables in memory (ADR 0004) persisted through `PrismaTableStore`, and their Socket.IO gateway.
 * Startup recovery runs in the background once the previous instance released the instance lock
 * (spec 3d §2b): Render starts this instance before it stops the old one, which is still draining.
 */
@Module({
  providers: [
    {
      provide: TABLE_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): TableSettings =>
        tableSettingsFromEnv(envFrom(config)),
    },
    {
      provide: TableDirector,
      inject: [TABLE_SETTINGS, PrismaService, NICKNAMES],
      useFactory: (
        settings: TableSettings,
        prisma: PrismaService,
        nicknames: NicknameDirectory,
      ): TableDirector =>
        new TableDirector({
          settings,
          scheduler: realScheduler,
          deckSource: new CryptoDeckSource(),
          store: new PrismaTableStore(prisma),
          logger: new Logger('Tables'),
          botRng,
          newTableId: () => randomUUID(),
          nameOf: (playerId) => nicknames.get(playerId),
        }),
    },
    {
      provide: TOKEN_VERIFIER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): TokenVerifier | null => {
        const supabaseUrl = config.get('SUPABASE_URL', { infer: true });
        return supabaseUrl ? new SupabaseTokenVerifier({ supabaseUrl }) : null;
      },
    },
    {
      provide: IDENTITY,
      inject: [ConfigService, ACCOUNTS, TOKEN_VERIFIER],
      useFactory: (
        config: ConfigService<Env, true>,
        accounts: AccountPort,
        verifier: TokenVerifier | null,
      ): IdentityPort =>
        createIdentity(
          {
            NODE_ENV: config.get('NODE_ENV', { infer: true }),
            DEV_IDENTITY: config.get('DEV_IDENTITY', { infer: true }),
          },
          accounts,
          verifier,
        ),
    },
    {
      provide: NICKNAMES,
      inject: [ACCOUNTS],
      useFactory: (accounts: AccountService): NicknameDirectory => new NicknameDirectory(accounts),
    },
    {
      provide: ACCOUNTS,
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, config: ConfigService<Env, true>): AccountService =>
        new AccountService(prisma, {
          initial: config.get('CHIPS_INITIAL', { infer: true }),
          refillTo: config.get('CHIPS_DAILY_REFILL_TO', { infer: true }),
        }),
    },
    {
      provide: RecoveryRunner,
      inject: [ConfigService, DATABASE_URL, PrismaService, TableDirector],
      useFactory: (
        config: ConfigService<Env, true>,
        databaseUrl: string,
        prisma: PrismaService,
        director: TableDirector,
      ): RecoveryRunner => {
        const logger = new Logger('Recovery');
        // A session-level lock: the session pooler (DIRECT_URL), never the transaction pooler.
        const url = config.get('DIRECT_URL', { infer: true }) ?? databaseUrl;
        return new RecoveryRunner({
          lock: new InstanceLock({ url, logger }),
          recovery: new RecoveryService(prisma),
          liveTableIds: () => new Set(director.tables().map((t) => t.id)),
          logger,
        });
      },
    },
    TableGateway,
  ],
  exports: [IDENTITY, ACCOUNTS, NICKNAMES, TableDirector, TableGateway],
})
export class TablesModule
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  constructor(
    private readonly director: TableDirector,
    private readonly gateway: TableGateway,
    private readonly recovery: RecoveryRunner,
  ) {}

  onApplicationBootstrap(): void {
    this.recovery.start();
  }

  /**
   * Nest closes the Socket.IO server between `beforeApplicationShutdown` and `onApplicationShutdown`
   * (discarding unsent messages): closing the tables here, then each connection once flushed, still
   * delivers `table:closed { reason: 'shutdown' }` (spec §5.5).
   */
  async beforeApplicationShutdown(): Promise<void> {
    await this.director.shutdown();
    await this.gateway.closeConnections();
    // Last: the next instance may now recover whatever is left (nothing, after a clean drain).
    await this.recovery.stop();
  }

  /** Idempotent backstop: nothing is left open by now. */
  onApplicationShutdown(): Promise<void> {
    return this.director.shutdown();
  }
}
