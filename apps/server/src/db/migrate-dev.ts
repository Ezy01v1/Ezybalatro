/**
 * `pnpm db:migrate:dev [-- --name <migration>]`: starts the persistent embedded Postgres in
 * apps/server/.local-db/ and runs `prisma migrate dev` against it.
 */
import { runPrisma, startEmbeddedDatabase } from './embedded-database';

async function main(): Promise<void> {
  const db = await startEmbeddedDatabase({ persistent: true });
  try {
    await runPrisma(['migrate', 'dev', ...process.argv.slice(2).filter((a) => a !== '--')], db.url, 'inherit');
  } finally {
    await db.stop();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
