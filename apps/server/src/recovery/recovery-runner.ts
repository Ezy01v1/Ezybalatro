import type { InstanceLock, LockLogger } from './instance-lock';
import type { RecoveryService } from './recovery.service';

/**
 * Startup recovery in the background (spec 3d §2b): the app serves right away, while this waits for
 * the previous instance to release the instance lock, then returns the seats it left behind,
 * skipping the tables this process already runs. On shutdown it stops waiting and, last of all,
 * releases the lock for the next instance.
 */
export class RecoveryRunner {
  private readonly abort = new AbortController();
  private running: Promise<void> | null = null;

  constructor(
    private readonly deps: {
      lock: InstanceLock;
      recovery: RecoveryService;
      liveTableIds: () => ReadonlySet<string>;
      logger: LockLogger;
    },
  ) {}

  start(): void {
    this.running ??= this.run();
  }

  /** Stops waiting for the lock, waits for a recovery in progress, then releases the lock. */
  async stop(): Promise<void> {
    this.abort.abort();
    await this.running;
    await this.deps.lock.release();
  }

  private async run(): Promise<void> {
    const { lock, recovery, liveTableIds, logger } = this.deps;
    try {
      await lock.acquire(this.abort.signal);
    } catch {
      return; // aborted: shutting down before the previous instance let go
    }
    try {
      const { seats, chips } = await recovery.recover({ exclude: liveTableIds });
      logger.log?.(
        `Startup recovery: ${seats} seat(s), ${chips} chip(s) returned; open tables closed`,
      );
    } catch (error) {
      const detail =
        error instanceof Error ? `${error.name}: ${error.message}` : 'non-Error thrown';
      logger.error(
        `Startup recovery failed: ${detail}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
