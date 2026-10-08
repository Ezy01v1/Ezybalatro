import type { Scheduler, Timer } from './ports';

/** `grace`: disconnected, sits out on expiry. `sittingOut`: sitting out, leaves on expiry. */
export type PlayerTimerKind = 'grace' | 'sittingOut';

/** Identifies one run of a timer, so a stale expiry can be told apart from the current one. */
export interface PlayerTimerToken {
  readonly timer: Timer;
}

/**
 * At most one timer of each kind per player. An expired timer stays registered until `take`
 * consumes it, so the expiry can be queued behind other commands without the timer being started
 * again in the meantime, and a `cancel` in between turns the queued expiry into a no-op.
 */
export class PlayerTimers {
  private readonly timers: Record<PlayerTimerKind, Map<string, PlayerTimerToken>> = {
    grace: new Map(),
    sittingOut: new Map(),
  };

  constructor(private readonly scheduler: Scheduler) {}

  has(kind: PlayerTimerKind, playerId: string): boolean {
    return this.timers[kind].has(playerId);
  }

  playerIds(kind: PlayerTimerKind): string[] {
    return [...this.timers[kind].keys()];
  }

  /** Does nothing if `playerId` already has a timer of this kind. */
  start(
    kind: PlayerTimerKind,
    playerId: string,
    ms: number,
    onExpire: (token: PlayerTimerToken) => void,
  ): void {
    const map = this.timers[kind];
    if (map.has(playerId)) return;
    const token: PlayerTimerToken = {
      timer: this.scheduler.schedule(ms, () => {
        if (map.get(playerId) === token) onExpire(token);
      }),
    };
    map.set(playerId, token);
  }

  /** True, removing the timer, if `token` is still the player's current timer of this kind. */
  take(kind: PlayerTimerKind, playerId: string, token: PlayerTimerToken): boolean {
    const map = this.timers[kind];
    if (map.get(playerId) !== token) return false;
    map.delete(playerId);
    return true;
  }

  cancel(kind: PlayerTimerKind, playerId: string): void {
    const map = this.timers[kind];
    map.get(playerId)?.timer.cancel();
    map.delete(playerId);
  }

  cancelAll(): void {
    for (const map of Object.values(this.timers)) {
      for (const token of map.values()) token.timer.cancel();
      map.clear();
    }
  }
}
