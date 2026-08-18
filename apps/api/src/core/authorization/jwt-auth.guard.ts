import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from './authorization.decorators';

/**
 * Global authentication guard.
 *
 * Registered app-wide (see CoreModule) so routes are authenticated BY DEFAULT
 * and must opt out explicitly with @Public(). The opposite arrangement — opt-in
 * protection — leaks any endpoint whose decorator someone forgets.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  override handleRequest<TUser = { userId: string }>(
    err: unknown,
    user: TUser | false,
  ): TUser {
    if (err || !user) {
      // Uniform message: never reveal whether the token was expired, malformed,
      // or belonged to a disabled account.
      throw new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
