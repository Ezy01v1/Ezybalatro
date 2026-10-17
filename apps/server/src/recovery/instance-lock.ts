import { Client } from 'pg';

/** Arbitrary, fixed key of the advisory lock held by the live server process ("naipes"). */
const LOCK_KEY = 0x6e61_6970;

export interface LockLogger {
  log?(message: string): void;
  warn(message: string): void;
  error(message: string, trace?: string): void;
}

/**
 * "This process owns the tables" (spec 3d §2b). Render starts the new instance before it stops the
 * old one: the new one only recovers seats once the old one let go of this lock, at the end of its
 * shutdown (or when its database session died with it).
 *
 * A Postgres session-level advisory lock on a dedicated connection. It needs a session: use the
 * direct or session-pooler URL, never the transaction pooler.
 */
export class InstanceLock {
  private client: Client | null = null;
  private readonly retryMs: number;
  private readonly heartbeatMs: number;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly opts: {
      url: string;
      logger: LockLogger;
      retryMs?: number;
      heartbeatMs?: number;
    },
  ) {
    this.retryMs = opts.retryMs ?? 2000;
    this.heartbeatMs = opts.heartbeatMs ?? 10_000;
  }

  /** Resolves once this process holds the lock; retries every `retryMs`. Rejects only if aborted. */
  async acquire(signal?: AbortSignal): Promise<void> {
    let waiting = false;
    for (;;) {
      if (signal?.aborted) throw new Error('InstanceLock: acquire aborted');
      try {
        if (await this.tryOnce()) {
          this.startHeartbeat();
          return;
        }
        if (!waiting)
          this.opts.logger.log?.('Waiting for the previous instance to release its lock');
        waiting = true;
      } catch (error) {
        const detail =
          error instanceof Error ? `${error.name}: ${error.message}` : 'non-Error thrown';
        this.opts.logger.error(`Instance lock: ${detail}; retrying`);
        await this.dropClient();
      }
      await sleep(this.retryMs, signal);
    }
  }

  /** Lets go of the lock (closes its connection). Idempotent. */
  async release(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    await this.dropClient();
  }

  /**
   * While held, checks the session every `heartbeatMs`: if the connection dropped (pooler restart,
   * network), the lock went with it, so reconnect and take it again. Ownership is best effort: the
   * chips stay safe regardless, because every seat payout is a conditional delete.
   */
  private startHeartbeat(): void {
    let busy = false;
    this.heartbeat = setInterval(() => {
      if (busy) return;
      busy = true;
      void this.keepHeld().finally(() => (busy = false));
    }, this.heartbeatMs);
    this.heartbeat.unref();
  }

  private async keepHeld(): Promise<void> {
    try {
      if (this.client) {
        await this.client.query('SELECT 1');
        return;
      }
      if (await this.tryOnce()) {
        this.opts.logger.warn('Instance lock: connection was lost; lock taken again');
      } else {
        this.opts.logger.error(
          'Instance lock: lost to another instance after a dropped connection',
        );
        await this.dropClient();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'non-Error thrown';
      this.opts.logger.error(`Instance lock heartbeat: ${detail}`);
      await this.dropClient();
    }
  }

  private async tryOnce(): Promise<boolean> {
    if (!this.client) {
      const client = new Client({ connectionString: this.opts.url, keepAlive: true });
      // A dropped session loses the lock: forget the client so the next acquire reconnects.
      client.on('error', (error) => {
        this.opts.logger.error(`Instance lock connection lost: ${error.message}`);
        if (this.client === client) this.client = null;
      });
      await client.connect();
      this.client = client;
    }
    const result = await this.client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [LOCK_KEY],
    );
    return result.rows[0]?.locked === true;
  }

  private async dropClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => undefined);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('InstanceLock: acquire aborted'));
      },
      { once: true },
    );
  });
}
