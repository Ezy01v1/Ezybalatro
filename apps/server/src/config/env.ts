import { z } from 'zod';

const int = (def: number) => z.coerce.number().int().default(def);

/**
 * Environment schema. The app refuses to start if anything is missing or invalid.
 * Keep .env.example in sync with this file.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    TABLE_SMALL_BLIND: int(10).pipe(z.number().min(1)),
    TABLE_BIG_BLIND: int(20).pipe(z.number().min(1)),
    TABLE_MIN_BUY_IN: int(400).pipe(z.number().min(1)),
    TABLE_MAX_BUY_IN: int(2000).pipe(z.number().min(1)),
    TABLE_MAX_SEATS: int(6),
    TABLE_BOT_FILL_TARGET: int(4).pipe(z.number().min(0)),
    TURN_TIMEOUT_MS: int(20000).pipe(z.number().min(1)),
    DISCONNECT_GRACE_MS: int(45000).pipe(z.number().min(0)),
    SITTING_OUT_MAX_MS: int(300000).pipe(z.number().min(0)),
    BETWEEN_HANDS_MS: int(3000).pipe(z.number().min(0)),
    EMPTY_TABLE_CLOSE_MS: int(60000).pipe(z.number().min(0)),
    CHIPS_INITIAL: int(10000).pipe(z.number().min(0)),
    CHIPS_DAILY_REFILL_TO: int(2000).pipe(z.number().min(0)),
    SOCKET_RATE_LIMIT_PER_SEC: int(10).pipe(z.number().min(1)),
    BOT_DELAY_MIN_MS: int(800).pipe(z.number().min(0)),
    BOT_DELAY_MAX_MS: int(2500).pipe(z.number().min(0)),
    // Connection strings: never echoed in errors or logs. Empty counts as missing.
    DATABASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    DIRECT_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    // Max connections of the app's pg pool (Supabase free tier has few pooler connections).
    DATABASE_POOL_MAX: int(5).pipe(z.number().min(1)),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (env.TABLE_SMALL_BLIND >= env.TABLE_BIG_BLIND) {
      fail('TABLE_SMALL_BLIND', 'must be lower than TABLE_BIG_BLIND');
    }
    if (env.TABLE_MIN_BUY_IN > env.TABLE_MAX_BUY_IN) {
      fail('TABLE_MIN_BUY_IN', 'must not exceed TABLE_MAX_BUY_IN');
    }
    if (env.TABLE_MAX_SEATS < 2 || env.TABLE_MAX_SEATS > 6) {
      fail('TABLE_MAX_SEATS', 'must be between 2 and 6');
    }
    if (env.TABLE_BOT_FILL_TARGET > env.TABLE_MAX_SEATS) {
      fail('TABLE_BOT_FILL_TARGET', 'must not exceed TABLE_MAX_SEATS');
    }
    if (env.NODE_ENV === 'production' && !env.DATABASE_URL) {
      fail('DATABASE_URL', 'required in production');
    }
    if (env.BOT_DELAY_MIN_MS > env.BOT_DELAY_MAX_MS) {
      fail('BOT_DELAY_MIN_MS', 'must not exceed BOT_DELAY_MAX_MS');
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
