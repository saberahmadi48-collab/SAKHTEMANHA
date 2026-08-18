import {
  SetMetadata,
  createParamDecorator,
  InternalServerErrorException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Permission, RequestScope } from '@bops/contracts';

import type { ScopedRequest } from './building-scope.guard';

export const IS_PUBLIC_KEY = 'bops:isPublic';
export const REQUIRED_PERMISSIONS_KEY = 'bops:requiredPermissions';
export const SCOPE_LEVEL_KEY = 'bops:scopeLevel';

/**
 * How a route is tenant-scoped.
 *  - 'building'     : route has :buildingId; full building scope is resolved.
 *  - 'organization' : route has :organizationId; org scope is resolved.
 *  - 'none'         : authenticated but not tenant-bound (/me, /auth/logout).
 *
 * 'building' is the DEFAULT when the decorator is absent — the safe direction.
 * Forgetting the decorator makes a route stricter, never more permissive.
 */
export type ScopeLevel = 'building' | 'organization' | 'none';

/** Marks a route as reachable without authentication (login, register). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ScopedTo = (level: ScopeLevel) =>
  SetMetadata(SCOPE_LEVEL_KEY, level);

/**
 * Declares the permissions a route requires. ALL of them must be held.
 * Applied by BuildingScopeGuard after the scope is resolved from the database.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * Injects the request's proven RequestScope into a controller method.
 *
 * Controllers should take this INSTEAD of reading `buildingId` from params.
 * That is the whole point: a handler that receives a `CurrentScope` cannot
 * accidentally operate on a building the caller never proved access to.
 */
export const CurrentScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestScope => {
    const request = context.switchToHttp().getRequest<ScopedRequest>();
    if (!request.scope) {
      // Programming error: the route is @Public or missing the guard, yet asks
      // for a scope. Fail loudly rather than handing back a permissive default.
      throw new InternalServerErrorException(
        'Route requested CurrentScope but no scope was resolved',
      );
    }
    return request.scope;
  },
);
