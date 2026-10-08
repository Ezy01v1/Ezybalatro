const WINDOW_MS = 1000;

interface Window {
  start: number;
  count: number;
}

/**
 * Fixed one-second windows per key (a socket id): at most `limitPerSec` messages per window. A
 * window opens with the first message after the previous one ended.
 */
export class SocketRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limitPerSec: number,
    private readonly now: () => number,
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= WINDOW_MS) {
      this.windows.set(key, { start: now, count: 1 });
      return this.limitPerSec >= 1;
    }
    if (window.count >= this.limitPerSec) return false;
    window.count++;
    return true;
  }

  forget(key: string): void {
    this.windows.delete(key);
  }
}
