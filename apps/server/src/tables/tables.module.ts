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
import { DevIdentity, IDENTITY } from '../realtime/identity';
import { TableGateway } from '../realtime/table.gateway';
import { CryptoDeckSource } from './crypto-deck-source';
import { HouseBankroll, InMemoryWallet } from './in-memory-wallet';
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

/** In-memory tables (Phase 3a, ADR 0004) and their Socket.IO gateway. */
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
      inject: [TABLE_SETTINGS],
      useFactory: (settings: TableSettings): TableDirector =>
        new TableDirector({
          settings,
          scheduler: realScheduler,
          deckSource: new CryptoDeckSource(),
          wallet: new InMemoryWallet(settings.devWalletInitial),
          house: new HouseBankroll(),
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
