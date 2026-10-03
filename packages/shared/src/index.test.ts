import { describe, expect, it } from 'vitest';
import { restErrorSchema, socketErrorSchema } from './index';

describe('shared schemas', () => {
  it('accepts the REST error envelope', () => {
    const parsed = restErrorSchema.parse({ error: { code: 'NOT_FOUND', message: 'x', requestId: 'r1' } });
    expect(parsed.error.code).toBe('NOT_FOUND');
  });

  it('rejects unknown socket error codes', () => {
    expect(socketErrorSchema.safeParse({ type: 'error', code: 'NOPE', message: 'x' }).success).toBe(false);
  });
});
