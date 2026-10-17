import type { InstanceLock } from './instance-lock';
import { RecoveryRunner } from './recovery-runner';
import type { RecoveryService } from './recovery.service';

function setup() {
  let grant: () => void = () => undefined;
  const lock = {
    acquire: jest.fn(
      (signal?: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          grant = resolve;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ),
    release: jest.fn(async () => undefined),
  };
  const recovery = { recover: jest.fn(async () => ({ seats: 1, chips: 400 })) };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const runner = new RecoveryRunner({
    lock: lock as unknown as InstanceLock,
    recovery: recovery as unknown as RecoveryService,
    liveTableIds: () => new Set(['live']),
    logger,
  });
  return { runner, lock, recovery, logger, grant: () => grant() };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('RecoveryRunner', () => {
  it('recovers only once the lock is acquired, excluding the live tables', async () => {
    const { runner, recovery, grant } = setup();
    runner.start();
    await tick();
    expect(recovery.recover).not.toHaveBeenCalled();

    grant();
    await tick();
    expect(recovery.recover).toHaveBeenCalledTimes(1);
    const [{ exclude }] = recovery.recover.mock.calls[0] as unknown as [
      { exclude: () => Set<string> },
    ];
    expect([...exclude()]).toEqual(['live']);
  });

  it('stop while waiting aborts, never recovers, and releases the lock', async () => {
    const { runner, lock, recovery } = setup();
    runner.start();
    await runner.stop();
    expect(recovery.recover).not.toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalled();
  });

  it('a failing recovery is logged, and stop still releases the lock', async () => {
    const { runner, lock, recovery, logger, grant } = setup();
    recovery.recover.mockRejectedValueOnce(new Error('db down'));
    runner.start();
    grant();
    await tick();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('db down'),
      expect.anything(),
    );
    await runner.stop();
    expect(lock.release).toHaveBeenCalled();
  });

  it('start is idempotent', async () => {
    const { runner, lock } = setup();
    runner.start();
    runner.start();
    expect(lock.acquire).toHaveBeenCalledTimes(1);
    await runner.stop();
  });
});
