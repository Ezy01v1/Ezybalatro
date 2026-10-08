import {
  decideBotAction,
  nextInt,
  type BotPersonality,
  type HoldemAction,
  type Rng,
} from '@naipes/engine';
import type { PlayerAction, TableUpdate } from '@naipes/shared';
import type { Scheduler, TableLogger, Timer } from '../tables/ports';
import type { TableMessage, TableRuntime } from '../tables/table-runtime';

export interface BotPlayerDeps {
  scheduler: Scheduler;
  rng: Rng;
  delayMs: { min: number; max: number };
  logger: TableLogger;
}

/** Immediate re-decisions allowed in a row after STALE_SEQ before waiting for the next update. */
const MAX_STALE_RETRIES = 3;

/** The betting action without its `playerId`; null for anything a bot must never send. */
function toPlayerAction(action: HoldemAction): PlayerAction | null {
  switch (action.type) {
    case 'bet':
      return { type: 'bet', amount: action.amount };
    case 'raise':
      return { type: 'raise', to: action.to };
    case 'fold':
    case 'check':
    case 'call':
    case 'allIn':
      return { type: action.type };
    default:
      return null;
  }
}

/**
 * A bot seat driver: subscribes to the table like a human and acts through the same command queue
 * with the engine's `decideBotAction`, after a human-like delay (spec §3.4).
 */
export class BotPlayer {
  private unsubscribe: (() => void) | null = null;
  private timer: Timer | null = null;
  private latest: TableUpdate | null = null;
  private stopped = false;

  constructor(
    private readonly table: TableRuntime,
    private readonly playerId: string,
    private readonly personality: BotPersonality,
    private readonly deps: BotPlayerDeps,
  ) {}

  start(): void {
    if (this.unsubscribe || this.stopped) return;
    this.unsubscribe = this.table.subscribe(this.playerId, (message) => this.onMessage(message));
  }

  stop(): void {
    this.stopped = true;
    this.timer?.cancel();
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onMessage(message: TableMessage): void {
    if (this.stopped) return;
    if (message.type === 'closed') {
      this.stop();
      return;
    }
    if (message.type === 'degraded') return;
    const update = message.update;
    if (update.events.some((e) => e.type === 'playerLeft' && e.playerId === this.playerId)) {
      this.stop();
      return;
    }
    this.latest = update;
    if (update.view.legal === null) {
      this.timer?.cancel();
      this.timer = null;
      return;
    }
    // Already waiting to decide: the timer will use the latest view when it fires.
    if (this.timer) return;
    const { min, max } = this.deps.delayMs;
    const delay = min + nextInt(this.deps.rng, Math.max(0, max - min) + 1);
    this.timer = this.deps.scheduler.schedule(delay, () => {
      this.timer = null;
      this.decide(0).catch((error: unknown) => this.logError(error));
    });
  }

  /**
   * A throwing decision must never become an unhandled rejection (it would take down the process
   * hosting every table). Nothing else to do: the runtime's turn timeout acts for a stuck bot.
   * Logs the error's name, message and stack only, never views or cards.
   */
  private logError(error: unknown): void {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'non-Error thrown';
    this.deps.logger.error(
      `BotPlayer ${this.playerId}: decision failed: ${detail}`,
      error instanceof Error ? error.stack : undefined,
    );
  }

  private async decide(staleRetries: number): Promise<void> {
    const latest = this.latest;
    if (this.stopped || !latest) return;
    const decision = decideBotAction(latest.view, this.deps.rng, this.personality);
    if (!decision) return;
    const action = toPlayerAction(decision);
    if (!action) return;
    const ack = await this.table.act(this.playerId, latest.seq, action);
    if (ack.ok || this.stopped) return;
    if (
      ack.error.code === 'STALE_SEQ' &&
      staleRetries < MAX_STALE_RETRIES &&
      this.latest !== null &&
      this.latest.seq !== latest.seq &&
      this.latest.view.legal !== null
    ) {
      await this.decide(staleRetries + 1);
    }
    // Any other error: wait for the next update; the turn timeout covers a stuck bot.
  }
}
