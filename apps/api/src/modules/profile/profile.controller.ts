import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ScopedTo } from '../../core/authorization/authorization.decorators';
import type { ScopedRequest } from '../../core/authorization/building-scope.guard';
import { ProfileService } from './profile.service';
import {
  UpdateMyProfileDto,
  type MyProfileResponse,
} from './dto/profile.dto';

/**
 * Self-service profile — BM-02 §41, §49 (`/api/users/me/profile`).
 *
 * `@ScopedTo('none')` is correct and load-bearing here: these routes are
 * authenticated but not tenant-bound, because "my profile" exists independently
 * of any building. Without it BuildingScopeGuard would demand a `:buildingId`
 * this route does not have and reject every call — the guard defaults to
 * 'building' precisely so a forgotten decorator fails CLOSED.
 *
 * NO @RequirePermissions ANYWHERE IN THIS FILE, and that is deliberate rather
 * than an oversight: permissions answer "may this caller act on someone else's
 * data", and the only row addressable from here is the caller's own. Adding a
 * permission gate would imply the subject could be someone else.
 */
@ApiTags('profile')
@Controller('users/me')
@ScopedTo('none')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get('profile')
  @ApiOperation({ summary: 'مشاهده مشخصات فردی خودم' })
  async getMine(@Req() request: ScopedRequest): Promise<MyProfileResponse> {
    return this.profile.getMyProfile(requireUserId(request));
  }

  @Patch('profile')
  @ApiOperation({ summary: 'ویرایش مشخصات فردی خودم' })
  async updateMine(
    @Body() dto: UpdateMyProfileDto,
    @Req() request: ScopedRequest,
  ): Promise<MyProfileResponse> {
    return this.profile.updateMyProfile(
      requireUserId(request),
      dto,
      requestContext(request),
    );
  }
}

/**
 * Extracts the authenticated user id set by JwtAuthGuard.
 *
 * Throws rather than returning a fallback: reaching a handler with no user id
 * means the guard chain was misconfigured, and silently treating that as
 * "anonymous" would hand an unauthenticated caller a profile.
 */
function requireUserId(request: ScopedRequest): string {
  const userId = request.user?.userId;
  if (!userId) throw new Error('JwtAuthGuard did not populate request.user');
  return userId;
}

/** Request metadata recorded on the audit row. */
function requestContext(request: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  return {
    ipAddress: request.ip,
    userAgent: request.get('user-agent') ?? undefined,
  };
}
