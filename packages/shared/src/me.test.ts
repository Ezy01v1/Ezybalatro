import { describe, expect, it } from 'vitest';
import { AVATAR_IDS, meResponseSchema, NICKNAME_REGEX, patchMeRequestSchema, socketErrorSchema } from './index';

const me = {
  id: '3f2b8c1e-6d7a-4c1b-9f10-2a5d7e8b9c01',
  nickname: 'ana',
  avatarId: 'a01',
  isGuest: true,
  balance: 1000,
  seatedAt: null,
};

describe('NICKNAME_REGEX and AVATAR_IDS', () => {
  it('matches 3-20 letters, digits and underscore only', () => {
    expect(NICKNAME_REGEX.test('Ana_01')).toBe(true);
    expect(NICKNAME_REGEX.test('ab')).toBe(false);
    expect(NICKNAME_REGEX.test('a'.repeat(21))).toBe(false);
    expect(NICKNAME_REGEX.test('ana lopez')).toBe(false);
    expect(NICKNAME_REGEX.test('ñandú')).toBe(false);
  });

  it('lists a01 to a12', () => {
    expect(AVATAR_IDS).toHaveLength(12);
    expect(AVATAR_IDS[0]).toBe('a01');
    expect(AVATAR_IDS[11]).toBe('a12');
  });
});

describe('meResponseSchema', () => {
  it('accepts a profile, with and without a seat or avatar', () => {
    expect(meResponseSchema.safeParse(me).success).toBe(true);
    expect(meResponseSchema.safeParse({ ...me, avatarId: null, seatedAt: { tableId: 't1', seat: 2 } }).success).toBe(true);
  });

  it('rejects a bad id, a fractional balance, an unknown avatar and extra keys', () => {
    expect(meResponseSchema.safeParse({ ...me, id: 'nope' }).success).toBe(false);
    expect(meResponseSchema.safeParse({ ...me, balance: 1.5 }).success).toBe(false);
    expect(meResponseSchema.safeParse({ ...me, avatarId: 'a99' }).success).toBe(false);
    expect(meResponseSchema.safeParse({ ...me, extra: 1 }).success).toBe(false);
  });
});

describe('patchMeRequestSchema', () => {
  it('accepts nickname, avatar or both', () => {
    expect(patchMeRequestSchema.safeParse({ nickname: 'ana_2' }).success).toBe(true);
    expect(patchMeRequestSchema.safeParse({ avatarId: 'a12' }).success).toBe(true);
    expect(patchMeRequestSchema.safeParse({ nickname: 'ana', avatarId: 'a03' }).success).toBe(true);
  });

  it('rejects empty bodies, bad nicknames, unknown avatars and unknown keys', () => {
    expect(patchMeRequestSchema.safeParse({}).success).toBe(false);
    expect(patchMeRequestSchema.safeParse({ nickname: 'a b' }).success).toBe(false);
    expect(patchMeRequestSchema.safeParse({ avatarId: 'a13' }).success).toBe(false);
    expect(patchMeRequestSchema.safeParse({ nickname: 'ana', balance: 9 }).success).toBe(false);
  });
});

describe('new error codes', () => {
  it.each(['NICKNAME_TAKEN', 'ACCOUNT_BUSY', 'NOT_CONFIGURED'])('socket schema accepts %s', (code) => {
    expect(socketErrorSchema.safeParse({ type: 'error', code, message: 'x' }).success).toBe(true);
  });
});
