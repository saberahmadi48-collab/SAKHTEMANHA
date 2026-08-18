import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Permission, RequestScope } from '@bops/contracts';
import { ERRORS, FIELDS, VALIDATION } from '@bops/i18n';

import { ScopeService } from './scope.service';
import {
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
  SCOPE_LEVEL_KEY,
  type ScopeLevel,
} from './authorization.decorators';

/** Express request augmented with the authenticated user and resolved scope. */
export interface ScopedRequest extends Request {
  user?: { userId: string };
  scope?: RequestScope;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolves and enforces the caller's scope for every request.
 *
 * Runs AFTER JwtAuthGuard (which only proves who the caller is) and turns the
 * route's `:buildingId` / `:organizationId` parameter from an untrusted string
 * into a proven RequestScope. This is the chokepoint BM-00 rule 8 demands:
 * a controller can only obtain a scope the database has confirmed.
 *
 * FAIL-CLOSED: a building-scoped route with no resolvable building is rejected,
 * never silently downgraded to an unscoped query.
 */
@Injectable()
export class BuildingScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly scopeService: ScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const userId = request.user?.userId;
    if (!userId) {
      // Should be impossible behind JwtAuthGuard; reaching here means the guard
      // order is wrong, so fail rather than resolve an empty scope.
      // The message stays user-facing Persian: this response can reach a
      // browser, and a leaked English internal string would breach the
      // all-Persian UI requirement.
      throw new ForbiddenException(ERRORS.unauthenticated);
    }

    const scopeLevel =
      this.reflector.getAllAndOverride<ScopeLevel>(SCOPE_LEVEL_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'building';

    // 'none' = authenticated but not tenant-scoped (e.g. /me, /auth/logout).
    if (scopeLevel === 'none') return true;

    const params = request.params as Record<string, string | undefined>;

    if (scopeLevel === 'organization') {
      const organizationId = params['organizationId'];
      this.assertUuid(organizationId, 'organizationId');
      request.scope = await this.scopeService.resolveForOrganization(
        userId,
        organizationId,
      );
    } else {
      const buildingId = params['buildingId'];
      this.assertUuid(buildingId, 'buildingId');
      request.scope = await this.scopeService.resolveForBuilding(
        userId,
        buildingId,
      );
    }

    return this.enforcePermissions(context, request.scope);
  }

  /**
   * Checks @RequirePermissions() metadata against the resolved scope.
   * ALL listed permissions must be held (AND, not OR) — an endpoint needing two
   * capabilities must not be reachable with only one.
   */
  private enforcePermissions(
    context: ExecutionContext,
    scope: RequestScope,
  ): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const missing = required.filter(
      (permission) => !scope.permissions.has(permission),
    );
    if (missing.length > 0) {
      // Names the permission, not the resource: tells a legitimate integrator
      // what to request without confirming to an attacker that it exists.
      // Permission codes stay Latin on purpose — they are machine identifiers
      // (`building:update`), not UI copy. The sentence around them is Persian,
      // and the web client maps each code to a Persian label before display.
      throw new ForbiddenException(ERRORS.missingPermissions(missing.join('، ')));
    }
    return true;
  }

  private assertUuid(
    value: string | undefined,
    name: 'buildingId' | 'organizationId',
  ): asserts value is string {
    if (!value || !UUID_PATTERN.test(value)) {
      const label =
        name === 'buildingId' ? FIELDS.building : FIELDS.organization;
      throw new BadRequestException(VALIDATION.invalid(`شناسه ${label}`));
    }
  }
}
