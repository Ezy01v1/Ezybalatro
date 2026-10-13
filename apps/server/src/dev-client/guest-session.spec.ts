import { guestConfig, parsePlayArgs } from './guest-session';

describe('parsePlayArgs', () => {
  it('parses --guest without a value, with url and buy-in', () => {
    expect(parsePlayArgs(['--guest', '--url', 'http://x:1', '--buy-in=500'])).toEqual({
      mode: { kind: 'guest' },
      url: 'http://x:1',
      buyIn: 500,
    });
  });

  it('keeps --name working and defaults the url', () => {
    expect(parsePlayArgs(['--name', 'ana'])).toEqual({
      mode: { kind: 'dev', name: 'ana' },
      url: 'http://localhost:3000',
      buyIn: undefined,
    });
  });

  it('rejects no mode, bad names, both modes and bad buy-ins', () => {
    for (const argv of [[], ['--name', 'a'], ['--guest', '--name', 'ana'], ['--guest', '--buy-in', '0'], ['--guest', '--url']]) {
      expect(parsePlayArgs(argv)).toHaveProperty('error');
    }
  });
});

describe('guestConfig', () => {
  it('returns the settings', () => {
    expect(guestConfig({ SUPABASE_URL: ' https://a.supabase.co ', SUPABASE_PUBLISHABLE_KEY: 'k' })).toEqual({
      supabaseUrl: 'https://a.supabase.co',
      publishableKey: 'k',
    });
  });

  it('names the missing variables without echoing values', () => {
    const result = guestConfig({ SUPABASE_URL: 'https://a.supabase.co' });
    expect(result).toEqual({ error: expect.stringContaining('SUPABASE_PUBLISHABLE_KEY') });
    expect(JSON.stringify(result)).not.toContain('a.supabase.co');
    expect(guestConfig({})).toEqual({
      error: expect.stringContaining('SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY'),
    });
  });
});
