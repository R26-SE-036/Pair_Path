import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC } from '../../common/public.decorator';

/**
 * Registered globally, so every route is protected unless marked @Public.
 *
 * It is also registered BEFORE the throttler, which is what lets rate limiting
 * bucket by student instead of by address - see common/public.decorator.ts.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    return isPublic ? true : super.canActivate(context);
  }
}
