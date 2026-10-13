import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Optional,
  Patch,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import { meResponseSchema, patchMeRequestSchema, type MeResponse } from '@naipes/shared';
import { z } from 'zod';
import {
  ACCOUNTS,
  AccountBusyError,
  NicknameTakenError,
  type AccountDeletionPort,
  type Profile,
  type ProfilePort,
} from '../accounts/account-port';
import { NICKNAMES, NicknameDirectory } from '../accounts/nickname-directory';
import { CurrentUser } from '../auth/current-user.decorator';
import { AUTH_ADMIN, type AuthAdminPort } from '../auth/supabase-admin';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { TableGateway } from '../realtime/table.gateway';
import type { Identity } from '../realtime/identity';
import { TableDirector } from '../tables/table-director';

type JsonSchema = Record<string, unknown>;
const jsonSchema = (schema: z.ZodType): JsonSchema => {
  const result = { ...(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema) };
  delete result.$schema;
  return result;
};

/** The REST error envelope (CLAUDE.md), for the docs. */
const ERROR_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
};
const ME_SCHEMA = jsonSchema(meResponseSchema);
const PATCH_SCHEMA = jsonSchema(patchMeRequestSchema);

const accountBusy = () =>
  new ConflictException({ code: 'ACCOUNT_BUSY', message: 'Seated in a hand in progress; try again shortly' });

const unauthorized = () => new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });

/** `/v1/me`: the authenticated user's profile, wallet balance and seat (spec §4). */
@ApiTags('me')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'UNAUTHORIZED: missing, invalid or deleted account token', schema: ERROR_SCHEMA })
@Controller('v1/me')
@UseGuards(SupabaseAuthGuard)
export class MeController {
  private readonly logger = new Logger('MeController');

  constructor(
    @Inject(ACCOUNTS) private readonly profiles: ProfilePort & AccountDeletionPort,
    @Inject(NICKNAMES) private readonly nicknames: NicknameDirectory,
    private readonly director: TableDirector,
    private readonly gateway: TableGateway,
    @Optional() @Inject(AUTH_ADMIN) private readonly authAdmin: AuthAdminPort | null,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'The profile', schema: ME_SCHEMA })
  async get(@CurrentUser() user: Identity): Promise<MeResponse> {
    const profile = await this.profiles.profile(user.userId);
    if (!profile) throw unauthorized();
    return this.response(user, profile);
  }

  @Patch()
  @ApiBody({ schema: PATCH_SCHEMA })
  @ApiOkResponse({ description: 'The updated profile', schema: ME_SCHEMA })
  @ApiResponse({ status: 400, description: 'INVALID_REQUEST', schema: ERROR_SCHEMA })
  @ApiResponse({ status: 409, description: 'NICKNAME_TAKEN', schema: ERROR_SCHEMA })
  async patch(@CurrentUser() user: Identity, @Body() body: unknown): Promise<MeResponse> {
    const parsed = patchMeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_REQUEST', message: 'Invalid request body' });
    }
    let profile: Profile | null;
    try {
      profile = await this.profiles.updateProfile(user.userId, parsed.data);
    } catch (error) {
      if (error instanceof NicknameTakenError) {
        throw new ConflictException({ code: 'NICKNAME_TAKEN', message: 'Nickname already taken' });
      }
      throw error;
    }
    if (!profile) throw unauthorized();
    // Tables where the user sits show the new nickname from their next update on.
    this.nicknames.set(user.userId, profile.nickname);
    return this.response(user, profile);
  }

  /**
   * Deletes the account by anonymizing it (spec §5): stand up from the table (409 `ACCOUNT_BUSY` if
   * the hand does not end in 30 s), empty the wallet and anonymize the profile in one transaction,
   * disconnect the user's socket, then delete the Supabase Auth user (a failure is retried at the
   * next startup). Without `SUPABASE_SECRET_KEY`: 503 `NOT_CONFIGURED`.
   */
  @Delete()
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'Account deleted (anonymized)' })
  @ApiResponse({ status: 409, description: 'ACCOUNT_BUSY: seated in a hand that did not end in time', schema: ERROR_SCHEMA })
  @ApiResponse({ status: 503, description: 'NOT_CONFIGURED: the server has no SUPABASE_SECRET_KEY', schema: ERROR_SCHEMA })
  async remove(@CurrentUser() user: Identity): Promise<void> {
    if (!this.authAdmin) {
      throw new ServiceUnavailableException({ code: 'NOT_CONFIGURED', message: 'Account deletion is not configured' });
    }
    const { userId } = user;
    if ((await this.director.evict(userId)) === 'busy') throw accountBusy();
    try {
      await this.profiles.deleteAccount(userId);
    } catch (error) {
      this.director.release(userId);
      if (error instanceof AccountBusyError) throw accountBusy();
      throw error;
    }
    await this.nicknames.load(userId); // forgets the nickname
    this.gateway.disconnectUser(userId);
    try {
      await this.authAdmin.deleteUser(userId);
      await this.profiles.markAuthDeleted(userId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'non-Error thrown';
      this.logger.warn(`Deleting Auth user ${userId} failed (${detail}); retried at next startup`);
    }
  }

  private response(user: Identity, profile: Profile): MeResponse {
    const table = this.director.tableOf(user.userId);
    const seat = table?.seatOf(user.userId) ?? null;
    return meResponseSchema.parse({
      id: user.userId,
      nickname: profile.nickname,
      avatarId: profile.avatarId,
      isGuest: user.isGuest,
      balance: profile.balance,
      seatedAt: table && seat !== null ? { tableId: table.id, seat } : null,
    });
  }
}
