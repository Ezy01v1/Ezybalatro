import { validateEnv } from './env';
import { tableSettingsFromEnv } from '../tables/table-settings';

describe('validateEnv', () => {
  it('applies defaults', () => {
    expect(validateEnv({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      CORS_ORIGINS: [],
      DATABASE_POOL_MAX: 5,
      TABLE_SMALL_BLIND: 10,
      TABLE_BIG_BLIND: 20,
      TABLE_MIN_BUY_IN: 400,
      TABLE_MAX_BUY_IN: 2000,
      TABLE_MAX_SEATS: 6,
      TABLE_BOT_FILL_TARGET: 4,
      TURN_TIMEOUT_MS: 20000,
      DISCONNECT_GRACE_MS: 45000,
      SITTING_OUT_MAX_MS: 300000,
      BETWEEN_HANDS_MS: 3000,
      EMPTY_TABLE_CLOSE_MS: 60000,
      CHIPS_INITIAL: 10000,
      CHIPS_DAILY_REFILL_TO: 2000,
      SOCKET_RATE_LIMIT_PER_SEC: 10,
      BOT_DELAY_MIN_MS: 800,
      BOT_DELAY_MAX_MS: 2500,
    });
  });

  it('parses a comma-separated CORS allowlist', () => {
    expect(validateEnv({ CORS_ORIGINS: 'http://a.test, http://b.test' }).CORS_ORIGINS).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
  });

  it('fails fast on invalid values', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects equal blinds', () => {
    expect(() => validateEnv({ TABLE_SMALL_BLIND: '20', TABLE_BIG_BLIND: '20' })).toThrow(
      /TABLE_SMALL_BLIND/,
    );
  });

  it('rejects min buy-in above max buy-in', () => {
    expect(() => validateEnv({ TABLE_MIN_BUY_IN: '3000' })).toThrow(/TABLE_MIN_BUY_IN/);
  });

  it('rejects seats outside 2..6', () => {
    expect(() => validateEnv({ TABLE_MAX_SEATS: '7' })).toThrow(/TABLE_MAX_SEATS/);
    expect(() => validateEnv({ TABLE_MAX_SEATS: '1' })).toThrow(/TABLE_MAX_SEATS/);
  });

  it('rejects bot fill target above max seats', () => {
    expect(() => validateEnv({ TABLE_MAX_SEATS: '3', TABLE_BOT_FILL_TARGET: '4' })).toThrow(
      /TABLE_BOT_FILL_TARGET/,
    );
  });

  it('rejects bot delay min above max', () => {
    expect(() => validateEnv({ BOT_DELAY_MIN_MS: '3000' })).toThrow(/BOT_DELAY_MIN_MS/);
  });

  it('DATABASE_POOL_MAX defaults to 5 and must be at least 1', () => {
    expect(validateEnv({}).DATABASE_POOL_MAX).toBe(5);
    expect(validateEnv({ DATABASE_POOL_MAX: '3' }).DATABASE_POOL_MAX).toBe(3);
    expect(() => validateEnv({ DATABASE_POOL_MAX: '0' })).toThrow(/DATABASE_POOL_MAX/);
  });

  it('DATABASE_URL and DIRECT_URL are optional outside production', () => {
    const env = validateEnv({ NODE_ENV: 'development' });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.DIRECT_URL).toBeUndefined();
    expect(validateEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/db' }).DATABASE_URL).toBe(
      'postgresql://u:p@h:5432/db',
    );
  });

  it('requires DATABASE_URL in production without echoing any value', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL: required in production/);
    expect(() => validateEnv({ NODE_ENV: 'production', DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
    expect(validateEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://x/y' }).NODE_ENV).toBe(
      'production',
    );
  });
});

describe('tableSettingsFromEnv', () => {
  it('maps env to settings', () => {
    expect(tableSettingsFromEnv(validateEnv({}))).toEqual({
      config: { maxSeats: 6, smallBlind: 10, bigBlind: 20, minBuyIn: 400, maxBuyIn: 2000 },
      timings: {
        turnTimeoutMs: 20000,
        disconnectGraceMs: 45000,
        sittingOutMaxMs: 300000,
        betweenHandsMs: 3000,
      },
      botFillTarget: 4,
      emptyTableCloseMs: 60000,
      botDelayMs: { min: 800, max: 2500 },
      devWalletInitial: 10000,
      socketRateLimitPerSec: 10,
    });
  });
});
