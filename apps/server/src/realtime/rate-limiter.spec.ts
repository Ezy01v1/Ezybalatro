import { SocketRateLimiter } from './rate-limiter';

describe('SocketRateLimiter', () => {
  it('rate limiter allows N per second and resets the next second', () => {
    let now = 10_000;
    const limiter = new SocketRateLimiter(3, () => now);

    expect([1, 2, 3, 4, 5].map(() => limiter.allow('a'))).toEqual([true, true, true, false, false]);
    // Other keys have their own budget.
    expect(limiter.allow('b')).toBe(true);

    now += 999;
    expect(limiter.allow('a')).toBe(false);

    now += 1; // a full second after the window opened
    expect([1, 2, 3, 4].map(() => limiter.allow('a'))).toEqual([true, true, true, false]);
  });

  it('forget drops the key', () => {
    const limiter = new SocketRateLimiter(1, () => 0);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    limiter.forget('a');
    expect(limiter.allow('a')).toBe(true);
  });
});
