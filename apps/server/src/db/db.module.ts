import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import type { EmbeddedDatabase } from './embedded-database';
import { DATABASE_POOL_MAX, DATABASE_URL, PrismaService } from './prisma.service';

/** The embedded dev database, when one was started (null with `DATABASE_URL`). */
const EMBEDDED_DATABASE = Symbol('EMBEDDED_DATABASE');

const logger = new Logger('Database');

/**
 * `DATABASE_URL` when set. Otherwise, outside production only, a persistent embedded Postgres in
 * `apps/server/.local-db/` (migrated on start). `embedded-postgres` is a devDependency: it is
 * loaded here, lazily, never on the production path. Connection strings are never logged.
 */
async function connect(config: ConfigService<Env, true>): Promise<{ url: string; embedded: EmbeddedDatabase | null }> {
  const url = config.get('DATABASE_URL', { infer: true });
  if (url) return { url, embedded: null };
  if (config.get('NODE_ENV', { infer: true }) === 'production') {
    // validateEnv already refuses this; kept as a backstop.
    throw new Error('DATABASE_URL is required in production');
  }
  logger.log('DATABASE_URL not set: starting the embedded Postgres in apps/server/.local-db/');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startEmbeddedDatabase } = require('./embedded-database') as typeof import('./embedded-database');
  const embedded = await startEmbeddedDatabase({ persistent: true });
  logger.log('Embedded Postgres ready');
  return { url: embedded.url, embedded };
}

/**
 * Postgres for the whole app (ADR 0005). The client disconnects (and the embedded database stops)
 * in `onApplicationShutdown`, after the tables cashed everybody out in `beforeApplicationShutdown`.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMBEDDED_DATABASE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => connect(config),
    },
    {
      provide: DATABASE_URL,
      inject: [EMBEDDED_DATABASE],
      useFactory: (db: { url: string }) => db.url,
    },
    {
      provide: DATABASE_POOL_MAX,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => config.get('DATABASE_POOL_MAX', { infer: true }),
    },
    PrismaService,
  ],
  exports: [PrismaService],
})
export class DbModule implements OnApplicationShutdown {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDED_DATABASE) private readonly db: { embedded: EmbeddedDatabase | null },
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
    await this.db.embedded?.stop();
  }
}
