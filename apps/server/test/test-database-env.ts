import type { DynamicModule, Type } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '../src/db/testing/test-database';

/**
 * One embedded Postgres per e2e file (migrated). Its URL becomes `DATABASE_URL` BEFORE `AppModule`
 * is loaded: `ConfigModule.forRoot` validates the environment when the module file is imported,
 * so e2e files load it with `loadAppModule()` after this, never with a static import.
 */
export async function startE2eDatabase(): Promise<TestDatabase> {
  const db = await createTestDatabase();
  process.env.DATABASE_URL = db.url;
  // The instance lock connects through DIRECT_URL: keep it on this database, never the developer's.
  process.env.DIRECT_URL = db.url;
  // The e2e suites connect as `dev:<name>`: opt in explicitly (it is off by default).
  process.env.DEV_IDENTITY = 'true';
  return db;
}

export async function loadAppModule(): Promise<Type | DynamicModule> {
  const { AppModule } = await import('../src/app.module.js');
  return AppModule;
}
