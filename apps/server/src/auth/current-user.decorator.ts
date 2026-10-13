import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Identity } from '../realtime/identity';
import type { AuthenticatedRequest } from './supabase-auth.guard';

/** The `Identity` set by `SupabaseAuthGuard`. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): Identity => {
  const identity = context.switchToHttp().getRequest<AuthenticatedRequest>().identity;
  if (!identity) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
  return identity;
});
