/** Pure parts of the console client: argument parsing and guest-credential validation (no I/O). */

export interface PlayOptions {
  /** `dev:<name>` identity (needs DEV_IDENTITY=true on the server) or a Supabase anonymous user. */
  mode: { kind: 'dev'; name: string } | { kind: 'guest' };
  url: string;
  buyIn: number | undefined;
}

export const USAGE =
  'Uso: pnpm play -- --guest [--url http://localhost:3000] [--buy-in 1000]\n' +
  '     pnpm play -- --name <nombre> [--url ...] [--buy-in ...]   (requiere DEV_IDENTITY=true en el servidor)\n' +
  '--name: 3 a 20 caracteres (letras, números o _)';

/** Options that take no value. */
const FLAGS = new Set(['guest']);

export function parsePlayArgs(argv: string[]): PlayOptions | { error: string } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=', 2) as [string, string | undefined];
    if (FLAGS.has(key)) {
      flags.add(key);
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined) return { error: `Falta el valor de --${key}` };
    values.set(key, value);
  }
  const name = values.get('name');
  if (flags.has('guest') && name !== undefined) {
    return { error: `Usa --guest o --name, no ambos.\n${USAGE}` };
  }
  let mode: PlayOptions['mode'];
  if (flags.has('guest')) {
    mode = { kind: 'guest' };
  } else if (name !== undefined && /^[A-Za-z0-9_]{3,20}$/.test(name)) {
    mode = { kind: 'dev', name };
  } else {
    return { error: USAGE };
  }
  const buyInText = values.get('buy-in');
  const buyIn = buyInText === undefined ? undefined : Number(buyInText);
  if (buyIn !== undefined && !(Number.isSafeInteger(buyIn) && buyIn > 0)) {
    return { error: '--buy-in debe ser un entero positivo' };
  }
  return { mode, url: values.get('url') ?? 'http://localhost:3000', buyIn };
}

/** Reads the public Supabase settings for the guest sign-in; errors never include the values. */
export function guestConfig(
  env: Record<string, string | undefined>,
): { supabaseUrl: string; publishableKey: string } | { error: string } {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const missing = [!supabaseUrl && 'SUPABASE_URL', !publishableKey && 'SUPABASE_PUBLISHABLE_KEY'].filter(
    Boolean,
  );
  if (!supabaseUrl || !publishableKey) {
    return { error: `Falta ${missing.join(' y ')} en apps/server/.env (necesario para --guest).` };
  }
  return { supabaseUrl, publishableKey };
}
