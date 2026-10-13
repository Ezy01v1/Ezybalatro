import type { ProfilePort } from './account-port';

/** Injection token of the `NicknameDirectory`. */
export const NICKNAMES = Symbol('NICKNAMES');

/**
 * Current nicknames of the users seen by this process (public data), for the `names` of every
 * `table:update`. Loaded when a socket connects and updated by `PATCH /v1/me`.
 */
export class NicknameDirectory {
  private readonly nicknames = new Map<string, string>();

  constructor(private readonly profiles: Pick<ProfilePort, 'profile'>) {}

  get(userId: string): string | undefined {
    return this.nicknames.get(userId);
  }

  set(userId: string, nickname: string): void {
    this.nicknames.set(userId, nickname);
  }

  /** Reads the nickname from the profile (a deleted or missing profile is forgotten). */
  async load(userId: string): Promise<void> {
    const profile = await this.profiles.profile(userId);
    if (profile) this.nicknames.set(userId, profile.nickname);
    else this.nicknames.delete(userId);
  }
}
