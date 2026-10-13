import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVER_ROOT } from './embedded-database';
import { createTestDatabase, type TestDatabase } from './testing/test-database';

describe('account_deletion migration on existing data', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db?.stop();
  });

  it('nulls invalid and duplicate nicknames instead of aborting', async () => {
    const run = (sql: string) => db.prisma.$executeRawUnsafe(sql);
    // Rewind to the pre-migration shape (the helper already applied every migration).
    await run('DROP INDEX "profiles_nickname_live_key"');
    await run('ALTER TABLE "profiles" DROP CONSTRAINT "profiles_nickname_format_check"');
    await run('ALTER TABLE "profiles" DROP COLUMN "avatar_id", DROP COLUMN "deleted_at"');
    await run('ALTER TABLE "profiles" ALTER COLUMN "nickname" SET NOT NULL');

    const ins = (id: string, nick: string, at: string) =>
      run(
        `INSERT INTO "profiles" ("id","nickname","created_at","updated_at") VALUES ('${id}','${nick}','${at}','${at}')`,
      );
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    const c = '00000000-0000-4000-8000-000000000003';
    const d = '00000000-0000-4000-8000-000000000004';
    await ins(a, 'a b', '2026-01-01T00:00:00Z'); // invalid
    await ins(b, 'dupe', '2026-01-02T00:00:00Z'); // oldest duplicate: kept
    await ins(c, 'dupe', '2026-01-03T00:00:00Z'); // newer duplicate: cleared
    await ins(d, 'unique_one', '2026-01-04T00:00:00Z');

    const sql = readFileSync(
      join(SERVER_ROOT, 'prisma/migrations/20261009000000_account_deletion/migration.sql'),
      'utf8',
    )
      .split('\n')
      .filter((l) => !l.startsWith('--') && !l.includes('ALTER TYPE')) // enum value already exists
      .join('\n');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await run(stmt);

    const rows = await db.prisma.$queryRaw<{ id: string; nickname: string | null }[]>`
      SELECT id::text AS id, nickname FROM profiles ORDER BY id`;
    expect(rows.map((r) => r.nickname)).toEqual([null, 'dupe', null, 'unique_one']);
  });
});
