import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PERMISSIONS, type RequestScope } from '@bops/contracts';

import {
  CurrentScope,
  RequirePermissions,
  ScopedTo,
} from '../../core/authorization/authorization.decorators';
import { MembersService } from './members.service';
import {
  EndMembershipDto,
  UpdateBuildingMembershipDto,
  UpdateOrganizationMembershipDto,
  type BuildingMemberResponse,
  type OrganizationMemberResponse,
} from './dto/member.dto';

/**
 * Building member directory and role administration — BM-01 §33
 * (`/api/buildings/{id}/members`).
 *
 * Nested under `:buildingId` for the same reason as units and invitations: the
 * guard proves the tenant from the URL before any handler runs, so a membership
 * id from another building simply cannot be reached from here.
 *
 * NOTE THERE IS NO `POST /members`. Memberships are created only by the
 * organization-creation transaction or by redeeming an invitation. A create
 * endpoint here would be a third path that skips both, which is exactly what
 * §33 forbids.
 */
@ApiTags('members')
@Controller('buildings/:buildingId/members')
@ScopedTo('building')
export class BuildingMembersController {
  constructor(private readonly members: MembersService) {}

  /** `includeEnded=true` also returns closed memberships (history, not noise). */
  @RequirePermissions(PERMISSIONS.MEMBER_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست اعضای ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query('includeEnded') includeEnded?: string,
  ): Promise<BuildingMemberResponse[]> {
    return this.members.listBuildingMembers(scope, includeEnded === 'true');
  }

  @RequirePermissions(PERMISSIONS.MEMBER_UPDATE_ROLE)
  @Patch(':membershipId')
  @ApiOperation({ summary: 'ویرایش نقش یا وضعیت عضو ساختمان' })
  async update(
    @Param('buildingId') _buildingId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateBuildingMembershipDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<BuildingMemberResponse> {
    return this.members.updateBuildingMembership(
      scope,
      membershipId,
      dto,
      requestContext(request),
    );
  }

  /**
   * Ends a membership — this platform's "remove member".
   *
   * POST `/end`, never DELETE: the row is retained with an `endedAt` stamp
   * (R2), and the verb must not imply the history goes away.
   */
  @RequirePermissions(PERMISSIONS.MEMBER_REMOVE)
  @Post(':membershipId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'پایان دادن به عضویت در ساختمان' })
  async end(
    @Param('buildingId') _buildingId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: EndMembershipDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<BuildingMemberResponse> {
    return this.members.endBuildingMembership(
      scope,
      membershipId,
      dto,
      requestContext(request),
    );
  }
}

/**
 * Organization member administration — `/api/organizations/{id}/members`.
 *
 * The service refuses to demote or remove the last live ORG_OWNER; that rule
 * lives there rather than here because it must hold for every caller of the
 * service, not only for requests that arrive through this controller.
 */
@ApiTags('members')
@Controller('organizations/:organizationId/members')
@ScopedTo('organization')
export class OrganizationMembersController {
  constructor(private readonly members: MembersService) {}

  @RequirePermissions(PERMISSIONS.MEMBER_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست اعضای سازمان' })
  async list(
    @Param('organizationId') _organizationId: string,
    @CurrentScope() scope: RequestScope,
    @Query('includeEnded') includeEnded?: string,
  ): Promise<OrganizationMemberResponse[]> {
    return this.members.listOrganizationMembers(scope, includeEnded === 'true');
  }

  @RequirePermissions(PERMISSIONS.MEMBER_UPDATE_ROLE)
  @Patch(':membershipId')
  @ApiOperation({ summary: 'ویرایش نقش یا وضعیت عضو سازمان' })
  async update(
    @Param('organizationId') _organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateOrganizationMembershipDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<OrganizationMemberResponse> {
    return this.members.updateOrganizationMembership(
      scope,
      membershipId,
      dto,
      requestContext(request),
    );
  }

  @RequirePermissions(PERMISSIONS.MEMBER_REMOVE)
  @Post(':membershipId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'پایان دادن به عضویت در سازمان' })
  async end(
    @Param('organizationId') _organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: EndMembershipDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<OrganizationMemberResponse> {
    return this.members.endOrganizationMembership(
      scope,
      membershipId,
      dto,
      requestContext(request),
    );
  }
}

/** Client metadata for the audit trail (BM-01 §38). */
function requestContext(request: Request) {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  };
}
