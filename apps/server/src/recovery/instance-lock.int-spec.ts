import { Client } from 'pg';
import { createTestDatabase, type TestDatabase } from '../db/testing/test-database';
import { InstanceLock } from './instance-lock';

const quietLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

/** Resolves to whether `promise` settled within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

describe('InstanceLock', () => {
  let db: TestDatabase;
  const locks: InstanceLock[] = [];
  const lock = (heartbeatMs = 50) => {
    const l = new InstanceLock({ url: db.url, logger: quietLogger, retryMs: 50, heartbeatMs });
    locks.push(l);
    return l;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterEach(async () => {
    await Promise.all(locks.splice(0).map((l) => l.release()));
  });
  afterAll(async () => {
    await db?.stop();
  });

  it('a second lock waits until the first is released', async () => {
    const first = lock();
    await first.acquire();
    const second = lock();
    const acquired = second.acquire();
    expect(await settlesWithin(acquired, 300)).toBe(false);

    await first.release();
    expect(await settlesWithin(acquired, 1000)).toBe(true);
  });

  it('the lock is released when its connection dies', async () => {
    const first = lock(60_000); // a crashed process: no heartbeat takes it back
    await first.acquire();
    const second = lock();
    const acquired = second.acquire();
    expect(await settlesWithin(acquired, 300)).toBe(false);

    // Kill the first lock's backend from outside, as if its process had crashed.
    const admin = new Client({ connectionString: db.url });
    await admin.connect();
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()`,
    );
    await admin.end();
    expect(await settlesWithin(acquired, 2000)).toBe(true);
  });

  it('acquire can be aborted', async () => {
    const first = lock();
    await first.acquire();
    const controller = new AbortController();
    const acquired = lock().acquire(controller.signal);
    controller.abort();
    await expect(acquired).rejects.toThrow(/abort/i);
  });

  it('release without acquire is a no-op', async () => {
    await expect(lock().release()).resolves.toBeUndefined();
  });

  it('regains the lock after its connection drops while held', async () => {
    const first = lock();
    await first.acquire();
    const admin = new Client({ connectionString: db.url });
    await admin.connect();
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 500)); // heartbeat reconnects and re-locks
    const held = await admin.query(
      `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted`,
    );
    await admin.end();
    expect(held.rows[0].n).toBe(1);
    const second = lock();
    expect(await settlesWithin(second.acquire(), 300)).toBe(false);
  });
});
