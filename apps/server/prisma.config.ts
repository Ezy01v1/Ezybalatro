import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env by itself. Variables already set (CI, embedded DB scripts) win.
const envFile = join(__dirname, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations always go through the direct (session) connection, never the transaction pooler.
  datasource: { url: process.env.DIRECT_URL },
});
