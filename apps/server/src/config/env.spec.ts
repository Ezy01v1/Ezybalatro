import { validateEnv } from './env';

describe('validateEnv', () => {
  it('applies defaults', () => {
    expect(validateEnv({})).toEqual({ NODE_ENV: 'development', PORT: 3000, CORS_ORIGINS: [] });
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
});
