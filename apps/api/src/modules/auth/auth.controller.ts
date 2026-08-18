import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  Public,
  ScopedTo,
} from '../../core/authorization/authorization.decorators';
import type { ScopedRequest } from '../../core/authorization/building-scope.guard';
import { AuthService, type RequestContext } from './auth.service';
import {
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  type AuthTokensResponse,
  type CurrentUserResponse,
} from './dto/auth.dto';

/**
 * Authentication endpoints — the first step of BM-01 §32 onboarding.
 *
 * TWO DECORATORS DO THE HEAVY LIFTING HERE:
 *
 *  - `@Public()` opts a route out of BOTH global guards. Only the four routes
 *    that genuinely cannot be authenticated carry it; `/auth/me` and
 *    `/auth/logout` deliberately do NOT.
 *
 *  - `@ScopedTo('none')` marks a route as authenticated but not tenant-bound.
 *    Without it BuildingScopeGuard would demand a `:buildingId` param that
 *    these routes do not have and reject every call — the guard defaults to
 *    'building' precisely so that forgetting the decorator fails CLOSED.
 *
 * RATE LIMITING is tightened well below the app-wide 120/min: credential
 * stuffing against login and account-farming against register are the realistic
 * threats to this controller, and the global limit is far too generous for them.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت‌نام و ایجاد حساب کاربری' })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
  ): Promise<AuthTokensResponse> {
    return this.authService.register(dto, requestContext(request));
  }

  @Public()
  // Deliberately stricter than register: this is the endpoint an attacker
  // hammers with a stolen credential list.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ورود به سامانه' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
  ): Promise<AuthTokensResponse> {
    return this.authService.login(dto, requestContext(request));
  }

  /**
   * Refresh is @Public because the caller's access token is expected to be
   * EXPIRED — that is the entire reason they are here. Authentication happens
   * against the refresh token itself inside the service.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تمدید نشست با توکن تازه‌سازی' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
  ): Promise<AuthTokensResponse> {
    return this.authService.refresh(dto.refreshToken, requestContext(request));
  }

  /**
   * Authenticated but unscoped: the caller proves who they are, and the user id
   * comes from the verified token — never from the body, which is why there is
   * no `userId` field to send.
   */
  @ScopedTo('none')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'خروج از حساب کاربری' })
  async logout(
    @Body() dto: LogoutDto,
    @Req() request: ScopedRequest,
  ): Promise<void> {
    await this.authService.logout(
      requireUserId(request),
      dto.refreshToken,
      requestContext(request),
    );
  }

  @ScopedTo('none')
  @Get('me')
  @ApiOperation({ summary: 'پروفایل کاربر جاری و فهرست دسترسی‌ها' })
  async me(@Req() request: ScopedRequest): Promise<CurrentUserResponse> {
    return this.authService.getCurrentUser(requireUserId(request));
  }
}

/**
 * Extracts the authenticated user id set by JwtAuthGuard.
 *
 * Throws rather than defaulting: reaching a non-@Public route without a user
 * means the guard chain is misconfigured, and silently continuing would run the
 * handler with no principal at all.
 */
function requireUserId(request: ScopedRequest): string {
  const userId = request.user?.userId;
  if (!userId) {
    throw new Error('Authenticated route reached without a resolved user');
  }
  return userId;
}

/**
 * Collects client metadata for session rows and the audit trail.
 *
 * `request.ip` respects Express's `trust proxy` setting. Behind a load balancer
 * that must be configured, otherwise every session records the proxy's address
 * and the audit trail becomes useless for tracing an incident.
 */
function requestContext(request: Request): RequestContext {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  };
}
