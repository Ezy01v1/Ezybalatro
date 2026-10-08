import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

/** apps/server, resolved from both src/db (ts-jest) and dist/src/db (compiled). */
export const SERVER_ROOT = findServerRoot(__dirname);

// Local-only throwaway cluster bound to localhost; not a secret.
const USER = 'postgres';
const PASSWORD = 'postgres';
const DEFAULT_PERSISTENT_PORT = 54329;

export interface EmbeddedDatabaseOptions {
  port?: number;
  dataDir?: string;
  /** false (default): temporary data dir, deleted on stop(). */
  persistent?: boolean;
}

export interface EmbeddedDatabase {
  url: string;
  stop(): Promise<void>;
}

/** Starts an embedded Postgres on a free port and applies the migrations (`prisma migrate deploy`). */
export async function startEmbeddedDatabase(opts: EmbeddedDatabaseOptions = {}): Promise<EmbeddedDatabase> {
  const persistent = opts.persistent ?? false;
  const dataDir =
    opts.dataDir ?? (persistent ? join(SERVER_ROOT, '.local-db') : mkdtempSync(join(tmpdir(), 'naipes-pg-')));
  const port = opts.port ?? (persistent ? DEFAULT_PERSISTENT_PORT : await freePort());

  // persistent: true for the library always; we delete temporary dirs ourselves (with retries,
  // because Windows can keep the directory locked for a moment after the server exits).
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: USER,
    password: PASSWORD,
    persistent: true,
    onLog: () => undefined,
  });
  if (!existsSync(join(dataDir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();

  const url = `postgresql://${USER}:${PASSWORD}@localhost:${port}/postgres`;
  const stop = async (): Promise<void> => {
    try {
      await pg.stop();
    } finally {
      if (!persistent && !opts.dataDir) await removeBestEffort(dataDir);
    }
  };
  try {
    await runPrisma(['migrate', 'deploy'], url);
  } catch (err) {
    await stop();
    throw err;
  }
  return { url, stop };
}

/** Runs the Prisma CLI of this package with `DIRECT_URL` pointing at `url`. */
export function runPrisma(args: string[], url: string, stdio: 'inherit' | 'pipe' = 'pipe'): Promise<void> {
  const cli = join(dirname(require.resolve('prisma/package.json', { paths: [SERVER_ROOT] })), 'build', 'index.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: SERVER_ROOT,
      env: { ...process.env, DIRECT_URL: url },
      stdio,
    });
    let output = '';
    child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`prisma ${args.join(' ')} failed (exit ${code})\n${output}`)),
    );
  });
}

/**
 * Deletes a temporary data dir; never throws. Windows can keep files locked (EPERM/EBUSY) for a
 * while after Postgres exits: retry, then leave the dir in the temp folder with a warning.
 */
async function removeBestEffort(dir: string): Promise<void> {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (err) {
      if (attempt === 10) {
        const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
        console.warn(`embedded-database: could not delete temporary data dir ${dir} (${code}); leaving it`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function findServerRoot(start: string): string {
  let dir = start;
  while (!existsSync(join(dir, 'prisma', 'schema.prisma'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('apps/server root not found');
    dir = parent;
  }
  return dir;
}
