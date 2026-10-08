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
  return db;
}

export async function loadAppModule(): Promise<Type | DynamicModule> {
  const { AppModule } = await import('../src/app.module.js');
  return AppModule;
}
