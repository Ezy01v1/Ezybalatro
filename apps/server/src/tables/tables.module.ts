import { randomInt, randomUUID } from 'node:crypto';
import {
  Logger,
  Module,
  type BeforeApplicationShutdown,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Rng } from '@naipes/engine';
import { envSchema, type Env } from '../config/env';
import { ACCOUNTS } from '../accounts/account-port';
import { AccountService } from '../accounts/account.service';
import { PrismaService } from '../db/prisma.service';
import { RecoveryService } from '../recovery/recovery.service';
import { DevIdentity, IDENTITY } from '../realtime/identity';
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

/** Resolved once startup recovery is done; the director (hence the gateway) depends on it. */
const RECOVERED = Symbol('RECOVERED');

/**
 * Tables in memory (ADR 0004) persisted through `PrismaTableStore`, and their Socket.IO gateway.
 * Startup recovery runs in a provider the director depends on: Nest awaits it before the app
 * listens, so no connection is accepted while seats from the previous process are being returned.
 */
@Module({
  providers: [
    {
      provide: RECOVERED,
      inject: [PrismaService],
      useFactory: async (prisma: PrismaService): Promise<true> => {
        const logger = new Logger('Recovery');
        const { seats, chips } = await new RecoveryService(prisma).recover();
        logger.log(`Startup recovery: ${seats} seat(s), ${chips} chip(s) returned; open tables closed`);
        return true;
      },
    },
    {
      provide: TABLE_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): TableSettings =>
        tableSettingsFromEnv(envFrom(config)),
    },
    {
      provide: TableDirector,
      inject: [TABLE_SETTINGS, PrismaService, RECOVERED],
      useFactory: (settings: TableSettings, prisma: PrismaService): TableDirector =>
        new TableDirector({
          settings,
          scheduler: realScheduler,
          deckSource: new CryptoDeckSource(),
          store: new PrismaTableStore(prisma),
          logger: new Logger('Tables'),
          botRng,
          newTableId: () => randomUUID(),
        }),
    },
    {
      provide: IDENTITY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DevIdentity =>
        new DevIdentity(config.get('NODE_ENV', { infer: true })),
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
    TableGateway,
  ],
})
export class TablesModule implements BeforeApplicationShutdown, OnApplicationShutdown {
  constructor(
    private readonly director: TableDirector,
    private readonly gateway: TableGateway,
  ) {}

  /**
   * Nest closes the Socket.IO server between `beforeApplicationShutdown` and `onApplicationShutdown`
   * (discarding unsent messages): closing the tables here, then each connection once flushed, still
   * delivers `table:closed { reason: 'shutdown' }` (spec §5.5).
   */
  async beforeApplicationShutdown(): Promise<void> {
    await this.director.shutdown();
    await this.gateway.closeConnections();
  }

  /** Idempotent backstop: nothing is left open by now. */
  onApplicationShutdown(): Promise<void> {
    return this.director.shutdown();
  }
}
