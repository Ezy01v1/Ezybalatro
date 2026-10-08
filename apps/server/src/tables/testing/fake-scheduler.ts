import type { Scheduler, Timer } from '../ports';

interface Entry {
  at: number;
  order: number;
  fn: () => void;
  cancelled: boolean;
}

/** Deterministic scheduler for tests. Time only moves through `advance`. */
export class FakeScheduler implements Scheduler {
  private time = 0;
  private counter = 0;
  private entries: Entry[] = [];

  now(): number {
    return this.time;
  }

  schedule(ms: number, fn: () => void): Timer {
    const entry: Entry = { at: this.time + ms, order: this.counter++, fn, cancelled: false };
    this.entries.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
        this.entries = this.entries.filter((e) => e !== entry);
      },
    };
  }

  /** Timers scheduled and neither fired nor cancelled. */
  pendingCount(): number {
    return this.entries.length;
  }

  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      let next: Entry | undefined;
      for (const e of this.entries) {
        if (e.at > target) continue;
        if (!next || e.at < next.at || (e.at === next.at && e.order < next.order)) next = e;
      }
      if (!next) break;
      this.entries = this.entries.filter((e) => e !== next);
      this.time = Math.max(this.time, next.at);
      if (!next.cancelled) next.fn();
      await this.flush();
    }
    this.time = target;
  }

  /** Drains the microtask queue. */
  async flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
  }
}
