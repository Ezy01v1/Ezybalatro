import { z } from 'zod';

/** 3-20 characters: letters, digits and underscore (same rule as the DB CHECK). */
export const NICKNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;

export const AVATAR_IDS = [
  'a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07', 'a08', 'a09', 'a10', 'a11', 'a12',
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

export const nicknameSchema = z.string().regex(NICKNAME_REGEX);
export const avatarIdSchema = z.enum(AVATAR_IDS);

/** GET /v1/me and the PATCH /v1/me response. */
export const meResponseSchema = z
  .object({
    id: z.uuid(),
    nickname: z.string(),
    avatarId: avatarIdSchema.nullable(),
    isGuest: z.boolean(),
    balance: z.number().int().nonnegative(),
    seatedAt: z.object({ tableId: z.string(), seat: z.number().int().nonnegative() }).strict().nullable(),
  })
  .strict();
export type MeResponse = z.infer<typeof meResponseSchema>;

/** PATCH /v1/me body: at least one of the two fields. */
export const patchMeRequestSchema = z
  .object({ nickname: nicknameSchema.optional(), avatarId: avatarIdSchema.optional() })
  .strict()
  .refine((v) => v.nickname !== undefined || v.avatarId !== undefined, {
    message: 'nickname or avatarId is required',
  });
export type PatchMeRequest = z.infer<typeof patchMeRequestSchema>;
