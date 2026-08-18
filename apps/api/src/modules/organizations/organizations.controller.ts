import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestScope } from '@bops/contracts';

import {
  CurrentScope,
  RequirePermissions,
  ScopedTo,
} from '../../core/authorization/authorization.decorators';
import type { ScopedRequest } from '../../core/authorization/building-scope.guard';
import { PERMISSIONS } from '@bops/contracts';
import { OrganizationsService } from './organizations.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  type OrganizationResponse,
  type OrganizationSummaryResponse,
} from './dto/organization.dto';

/**
 * Organization endpoints (BM-01 §41 boundary `/api/organizations`).
 *
 * TWO DIFFERENT SCOPE LEVELS LIVE IN THIS ONE CONTROLLER, and the difference is
 * the whole security story:
 *
 *  - `POST /organizations` and `GET /organizations` are @ScopedTo('none'):
 *    authenticated, but not bound to a tenant. They MUST be, because the caller
 *    has no organization yet (create) or is asking which ones they have (list).
 *    Both derive everything from the JWT's user id — neither accepts an
 *    organization id from the client.
 *
 *  - Every `:organizationId` route is @ScopedTo('organization'), so
 *    BuildingScopeGuard proves live membership against the database BEFORE the
 *    handler runs, and the handler receives a @CurrentScope it cannot forge.
 *    This is what makes IDOR structurally impossible here (BM-01 §31, §39):
 *    swapping the id in the URL yields 403 at the guard, not a leaked row.
 */
@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /**
   * Creates an organization; the caller becomes its ORG_OWNER.
   * Unscoped because a new account belongs to nothing yet — BM-01 §32 step 2.
   */
  @ScopedTo('none')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد سازمان جدید' })
  async create(
    @Body() dto: CreateOrganizationDto,
    @Req() request: ScopedRequest,
  ): Promise<OrganizationResponse> {
    return this.organizations.create(
      requireUserId(request),
      dto,
      requestContext(request),
    );
  }

  /** Organizations the caller belongs to — the data behind the tenant switcher. */
  @ScopedTo('none')
  @Get()
  @ApiOperation({ summary: 'فهرست سازمان‌های کاربر جاری' })
  async list(
    @Req() request: ScopedRequest,
  ): Promise<OrganizationSummaryResponse[]> {
    return this.organizations.listForUser(requireUserId(request));
  }

  /**
   * The `:organizationId` param is read by the GUARD, not by this handler —
   * that is why the handler takes a scope instead. Declaring the param here is
   * only what makes Nest route the request.
   */
  @ScopedTo('organization')
  @Get(':organizationId')
  @ApiOperation({ summary: 'مشاهده اطلاعات سازمان' })
  async findOne(
    @Param('organizationId') _organizationId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<OrganizationResponse> {
    return this.organizations.findOne(scope);
  }

  @ScopedTo('organization')
  @RequirePermissions(PERMISSIONS.BUILDING_UPDATE)
  @Patch(':organizationId')
  @ApiOperation({ summary: 'ویرایش اطلاعات سازمان' })
  async update(
    @Param('organizationId') _organizationId: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: ScopedRequest,
  ): Promise<OrganizationResponse> {
    return this.organizations.update(scope, dto, requestContext(request));
  }

  /**
   * Soft-archives the organization (R2 — nothing is ever hard-deleted).
   *
   * Gated on BUILDING_ARCHIVE, which only ORG_OWNER holds: the permission
   * matrix deliberately withholds it from ORG_ADMIN so day-to-day
   * administration cannot retire the tenant.
   */
  @ScopedTo('organization')
  @RequirePermissions(PERMISSIONS.BUILDING_ARCHIVE)
  @Post(':organizationId/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'بایگانی سازمان' })
  async archive(
    @Param('organizationId') _organizationId: string,
    @CurrentScope() scope: RequestScope,
    @Req() request: ScopedRequest,
  ): Promise<OrganizationResponse> {
    return this.organizations.archive(scope, requestContext(request));
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
