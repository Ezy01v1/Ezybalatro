import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { IDENTITY, type Identity, type IdentityPort } from '../realtime/identity';

/** The request after `SupabaseAuthGuard`: the authenticated user. */
export interface AuthenticatedRequest extends Request {
  identity?: Identity;
}

const BEARER = /^Bearer ([^\s]+)$/;

/**
 * REST auth: `Authorization: Bearer <Supabase access token>` checked by the same `IdentityPort` as
 * the table socket (local JWKS verification, deleted profiles rejected, account created on first
 * contact; `dev:<name>` only with `DEV_IDENTITY=true` outside production). Anything else → 401.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(@Inject(IDENTITY) private readonly identity: IdentityPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = BEARER.exec(request.headers.authorization ?? '');
    const identity = match ? await this.identity.authenticate({ token: match[1] }) : null;
    if (!identity) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    request.identity = identity;
    return true;
  }
}
