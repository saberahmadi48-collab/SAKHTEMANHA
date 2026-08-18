import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PERMISSIONS, type RequestScope } from '@bops/contracts';

import {
  CurrentScope,
  Public,
  RequirePermissions,
  ScopedTo,
} from '../../core/authorization/authorization.decorators';
import type { ScopedRequest } from '../../core/authorization/building-scope.guard';
import { InvitationsService } from './invitations.service';
import {
  AcceptInvitationDto,
  CreateBuildingInvitationDto,
  CreateOrganizationInvitationDto,
  type AcceptInvitationResponse,
  type CreatedInvitationResponse,
  type InvitationPreviewResponse,
  type InvitationResponse,
} from './dto/invitation.dto';

/**
 * Organization-tier invitations — BM-01 §33 (`/api/organizations/{id}/invitations`).
 *
 * Every route is @ScopedTo('organization'), so BuildingScopeGuard proves live
 * membership before the handler runs and the handler receives a scope it cannot
 * forge. The invited tenant therefore comes from the URL the guard validated,
 * never from the request body.
 */
@ApiTags('invitations')
@Controller('organizations/:organizationId/invitations')
@ScopedTo('organization')
export class OrganizationInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @RequirePermissions(PERMISSIONS.MEMBER_INVITE)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'دعوت عضو جدید به سازمان' })
  async create(
    @Param('organizationId') _organizationId: string,
    @Body() dto: CreateOrganizationInvitationDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<CreatedInvitationResponse> {
    return this.invitations.createForOrganization(
      scope,
      dto,
      requestContext(request),
    );
  }

  /** Pending invitations; `includeResolved=true` also returns finished ones. */
  @RequirePermissions(PERMISSIONS.MEMBER_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست دعوت‌نامه‌های سازمان' })
  async list(
    @Param('organizationId') _organizationId: string,
    @CurrentScope() scope: RequestScope,
    @Query('includeResolved') includeResolved?: string,
  ): Promise<InvitationResponse[]> {
    return this.invitations.listForOrganization(
      scope,
      includeResolved === 'true',
    );
  }

  /**
   * Withdraws a pending invitation (§34).
   *
   * POST, not DELETE: the row is retained as REVOKED (R2), and the verb should
   * not suggest otherwise.
   */
  @RequirePermissions(PERMISSIONS.MEMBER_INVITE)
  @Post(':invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ابطال دعوت‌نامه' })
  async revoke(
    @Param('organizationId') _organizationId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<InvitationResponse> {
    return this.invitations.revoke(
      scope,
      invitationId,
      requestContext(request),
    );
  }
}

/**
 * Building-tier invitations — `/api/buildings/{id}/invitations`.
 *
 * The nesting under `:buildingId` is the security model, exactly as in
 * UnitsController: the guard resolves the tenant from the URL before any
 * handler runs, so an inviter cannot issue an invitation into a building they
 * have not proven access to.
 */
@ApiTags('invitations')
@Controller('buildings/:buildingId/invitations')
@ScopedTo('building')
export class BuildingInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @RequirePermissions(PERMISSIONS.MEMBER_INVITE)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'دعوت عضو جدید به ساختمان' })
  async create(
    @Param('buildingId') _buildingId: string,
    @Body() dto: CreateBuildingInvitationDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<CreatedInvitationResponse> {
    return this.invitations.createForBuilding(
      scope,
      dto,
      requestContext(request),
    );
  }

  @RequirePermissions(PERMISSIONS.MEMBER_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست دعوت‌نامه‌های ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query('includeResolved') includeResolved?: string,
  ): Promise<InvitationResponse[]> {
    return this.invitations.listForBuilding(scope, includeResolved === 'true');
  }

  @RequirePermissions(PERMISSIONS.MEMBER_INVITE)
  @Post(':invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ابطال دعوت‌نامه' })
  async revoke(
    @Param('buildingId') _buildingId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<InvitationResponse> {
    return this.invitations.revoke(
      scope,
      invitationId,
      requestContext(request),
    );
  }
}

/**
 * Redemption endpoints — the invitee's side of §32/§33.
 *
 * THESE ROUTES ARE DELIBERATELY NOT TENANT-SCOPED, and that is the whole point:
 * the caller has no membership yet, so there is no scope to resolve. What
 * protects them is that the TOKEN is the only input and the server derives
 * everything else from the stored row.
 *
 *  - `preview` is @Public because the recipient may not have an account yet
 *    (§32 onboarding starts with "create account", and the invitation link is
 *    frequently what brings them there). It returns display names only.
 *  - `accept` is @ScopedTo('none') — authenticated, but bound to no tenant. It
 *    must be authenticated: the whole operation is "attach THIS user to that
 *    grant", so an anonymous caller has nothing to attach.
 *
 * Both are rate-limited harder than the global default. A token is 256 bits so
 * guessing is infeasible, but an unthrottled lookup endpoint is still a free
 * oracle and a cheap way to burn database round trips.
 */
@ApiTags('invitations')
@Controller('invitations')
export class InvitationRedemptionController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('preview')
  @ApiOperation({ summary: 'مشاهده اطلاعات دعوت‌نامه پیش از پذیرش' })
  async preview(
    @Query('token') token: string,
  ): Promise<InvitationPreviewResponse> {
    return this.invitations.preview(token ?? '');
  }

  @ScopedTo('none')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'پذیرش دعوت‌نامه' })
  async accept(
    @Body() dto: AcceptInvitationDto,
    @Req() request: ScopedRequest,
  ): Promise<AcceptInvitationResponse> {
    return this.invitations.accept(
      requireUserId(request),
      dto.token,
      requestContext(request),
    );
  }
}

/**
 * Extracts the authenticated user id set by JwtAuthGuard.
 * Throws rather than defaulting: reaching a non-@Public route without a user
 * means the guard chain is misconfigured.
 */
function requireUserId(request: ScopedRequest): string {
  const userId = request.user?.userId;
  if (!userId) {
    throw new Error('Authenticated route reached without a resolved user');
  }
  return userId;
}

/** Client metadata for the audit trail (BM-01 §38). */
function requestContext(request: Request) {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  };
}
