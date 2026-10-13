import { validateEnv } from './env';
import { tableSettingsFromEnv } from '../tables/table-settings';

/** Minimal valid identity config: most tests are about other variables. */
const ID = { DEV_IDENTITY: 'true' };

describe('validateEnv', () => {
  it('applies defaults', () => {
    expect(validateEnv({ ...ID })).toEqual({
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
      LOG_LEVEL: 'info',
      DEV_IDENTITY: true,
    });
  });

  it('parses a comma-separated CORS allowlist', () => {
    expect(validateEnv({ ...ID, CORS_ORIGINS: 'http://a.test, http://b.test' }).CORS_ORIGINS).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
  });

  it('fails fast on invalid values', () => {
    expect(() => validateEnv({ ...ID, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects equal blinds', () => {
    expect(() => validateEnv({ ...ID, TABLE_SMALL_BLIND: '20', TABLE_BIG_BLIND: '20' })).toThrow(
      /TABLE_SMALL_BLIND/,
    );
  });

  it('rejects min buy-in above max buy-in', () => {
    expect(() => validateEnv({ ...ID, TABLE_MIN_BUY_IN: '3000' })).toThrow(/TABLE_MIN_BUY_IN/);
  });

  it('rejects seats outside 2..6', () => {
    expect(() => validateEnv({ ...ID, TABLE_MAX_SEATS: '7' })).toThrow(/TABLE_MAX_SEATS/);
    expect(() => validateEnv({ ...ID, TABLE_MAX_SEATS: '1' })).toThrow(/TABLE_MAX_SEATS/);
  });

  it('rejects bot fill target above max seats', () => {
    expect(() => validateEnv({ ...ID, TABLE_MAX_SEATS: '3', TABLE_BOT_FILL_TARGET: '4' })).toThrow(
      /TABLE_BOT_FILL_TARGET/,
    );
  });

  it('rejects bot delay min above max', () => {
    expect(() => validateEnv({ ...ID, BOT_DELAY_MIN_MS: '3000' })).toThrow(/BOT_DELAY_MIN_MS/);
  });

  it('DATABASE_POOL_MAX defaults to 5 and must be at least 1', () => {
    expect(validateEnv({ ...ID }).DATABASE_POOL_MAX).toBe(5);
    expect(validateEnv({ ...ID, DATABASE_POOL_MAX: '3' }).DATABASE_POOL_MAX).toBe(3);
    expect(() => validateEnv({ ...ID, DATABASE_POOL_MAX: '0' })).toThrow(/DATABASE_POOL_MAX/);
  });

  it('DATABASE_URL and DIRECT_URL are optional outside production', () => {
    const env = validateEnv({ ...ID, NODE_ENV: 'development' });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.DIRECT_URL).toBeUndefined();
    expect(validateEnv({ ...ID, DATABASE_URL: 'postgresql://u:p@h:5432/db' }).DATABASE_URL).toBe(
      'postgresql://u:p@h:5432/db',
    );
  });

  it('requires DATABASE_URL in production without echoing any value', () => {
    expect(() => validateEnv({ SUPABASE_URL: 'https://p.supabase.co', NODE_ENV: 'production' })).toThrow(/DATABASE_URL: required in production/);
    expect(() => validateEnv({ SUPABASE_URL: 'https://p.supabase.co', NODE_ENV: 'production', DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
    expect(validateEnv({ SUPABASE_URL: 'https://p.supabase.co', NODE_ENV: 'production', DATABASE_URL: 'postgresql://x/y', SUPABASE_SECRET_KEY: 'sb_secret_x' }).NODE_ENV).toBe(
      'production',
    );
  });
});

describe('tableSettingsFromEnv', () => {
  it('maps env to settings', () => {
    expect(tableSettingsFromEnv(validateEnv({ ...ID }))).toEqual({
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

describe('identity env', () => {
  const SUPA = 'https://proj.supabase.co';

  it('DEV_IDENTITY defaults to false and then SUPABASE_URL is required', () => {
    expect(() => validateEnv({})).toThrow(/SUPABASE_URL/);
    expect(() => validateEnv({ DEV_IDENTITY: 'false' })).toThrow(/SUPABASE_URL/);
    const env = validateEnv({ SUPABASE_URL: SUPA });
    expect(env.DEV_IDENTITY).toBe(false);
    expect(env.SUPABASE_URL).toBe(SUPA);
  });

  it('DEV_IDENTITY=true outside production makes SUPABASE_URL optional', () => {
    expect(validateEnv({ DEV_IDENTITY: 'true' }).SUPABASE_URL).toBeUndefined();
    expect(validateEnv({ DEV_IDENTITY: 'true', NODE_ENV: 'test', SUPABASE_URL: SUPA }).DEV_IDENTITY).toBe(true);
  });

  it('DEV_IDENTITY=true in production fails startup', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://x/y', SUPABASE_URL: SUPA, DEV_IDENTITY: 'true' }),
    ).toThrow(/DEV_IDENTITY/);
    expect(() => validateEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://x/y' })).toThrow(/SUPABASE_URL/);
  });

  it('rejects malformed DEV_IDENTITY and SUPABASE_URL values', () => {
    expect(() => validateEnv({ SUPABASE_URL: SUPA, DEV_IDENTITY: 'yes' })).toThrow(/DEV_IDENTITY/);
    expect(() => validateEnv({ SUPABASE_URL: 'not a url' })).toThrow(/SUPABASE_URL/);
    expect(validateEnv({ SUPABASE_URL: '', DEV_IDENTITY: 'true' }).SUPABASE_URL).toBeUndefined();
  });

  it('SUPABASE_SECRET_KEY: optional outside production, required in production, never echoed', () => {
    expect(validateEnv({ SUPABASE_URL: SUPA }).SUPABASE_SECRET_KEY).toBeUndefined();
    expect(validateEnv({ SUPABASE_URL: SUPA, SUPABASE_SECRET_KEY: '' }).SUPABASE_SECRET_KEY).toBeUndefined();
    const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://x/y', SUPABASE_URL: SUPA };
    expect(() => validateEnv(prod)).toThrow(/SUPABASE_SECRET_KEY: required in production/);
    expect(validateEnv({ ...prod, SUPABASE_SECRET_KEY: 'sb_secret_abc' }).SUPABASE_SECRET_KEY).toBe('sb_secret_abc');
    expect(() => validateEnv({ ...prod, SUPABASE_SECRET_KEY: 'sb_secret_abc', PORT: 'x' })).not.toThrow(/sb_secret_abc/);
  });
});
