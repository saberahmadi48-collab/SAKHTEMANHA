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
import { PERMISSIONS, type RequestScope } from '@bops/contracts';

import {
  CurrentScope,
  RequirePermissions,
  ScopedTo,
} from '../../core/authorization/authorization.decorators';
import { BuildingsService } from './buildings.service';
import {
  ChangeBuildingStatusDto,
  CreateBuildingDto,
  UpdateBuildingDto,
  UpdateBuildingSettingsDto,
  type BuildingResponse,
  type BuildingSettingsResponse,
  type BuildingSummaryResponse,
} from './dto/building.dto';

/**
 * Organization-scoped building routes — BM-01 §41
 * (`/api/organizations/{id}/buildings`).
 *
 * WHY THESE TWO LIVE ON A SEPARATE CONTROLLER FROM THE REST:
 * creating and listing buildings happen BEFORE any building exists to be
 * scoped to, so they must resolve authority from the organization. Nest applies
 * scope level per class/handler, and mixing 'organization' and 'building'
 * routes in one controller makes it far too easy for a later route to inherit
 * the wrong one — which would be a silent tenancy hole, not a visible error.
 */
@ApiTags('buildings')
@Controller('organizations/:organizationId/buildings')
@ScopedTo('organization')
export class OrganizationBuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  /**
   * Creates a building under the caller's organization (BM-01 §32 step 3).
   *
   * The body carries NO organizationId — it comes from the proven scope. That
   * is §40's requirement stated as code: "the API must not trust
   * client-provided ownership context".
   *
   * May return 409 with a `duplicates` array when the building looks like one
   * that already exists (§35); the client shows them and retries with
   * `confirmPossibleDuplicate: true`.
   */
  @RequirePermissions(PERMISSIONS.BUILDING_UPDATE)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد ساختمان جدید در سازمان' })
  async create(
    @Param('organizationId') _organizationId: string,
    @Body() dto: CreateBuildingDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<BuildingResponse> {
    return this.buildings.create(scope, dto, requestContext(request));
  }

  /** Buildings in this organization the caller may actually see (§5 rule 5). */
  @RequirePermissions(PERMISSIONS.BUILDING_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست ساختمان‌های سازمان' })
  async list(
    @Param('organizationId') _organizationId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<BuildingSummaryResponse[]> {
    return this.buildings.listForScope(scope);
  }
}

/**
 * Building-scoped routes — BM-01 §41 (`/api/buildings/{id}`).
 *
 * Every route here is @ScopedTo('building') (the class default, and also the
 * guard's fallback), so BuildingScopeGuard proves live membership for the
 * `:buildingId` in the URL before any handler runs. Swapping the id for another
 * tenant's building returns 403 at the guard — §31's "GET /api/buildings/B/units
 * → 403 Forbidden" is enforced structurally, not by each handler remembering to
 * check.
 */
@ApiTags('buildings')
@Controller('buildings/:buildingId')
@ScopedTo('building')
export class BuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  /**
   * Building profile. Coordinates are filtered server-side by
   * `applyLocationPrecision` before the response is assembled (§12).
   */
  @RequirePermissions(PERMISSIONS.BUILDING_READ)
  @Get()
  @ApiOperation({ summary: 'مشاهده اطلاعات ساختمان' })
  async findOne(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<BuildingResponse> {
    return this.buildings.findOne(scope);
  }

  @RequirePermissions(PERMISSIONS.BUILDING_UPDATE)
  @Patch()
  @ApiOperation({ summary: 'ویرایش اطلاعات ساختمان' })
  async update(
    @Param('buildingId') _buildingId: string,
    @Body() dto: UpdateBuildingDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<BuildingResponse> {
    return this.buildings.update(scope, dto, requestContext(request));
  }

  /**
   * Lifecycle transition (§8).
   *
   * Requires BUILDING_ARCHIVE rather than BUILDING_UPDATE: the elected manager
   * runs the building day to day but must not be able to retire the permanent
   * entity (BM-00 rule 1). Only the organization tier holds that permission.
   */
  @RequirePermissions(PERMISSIONS.BUILDING_ARCHIVE)
  @Post('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تغییر وضعیت چرخه حیات ساختمان' })
  async changeStatus(
    @Param('buildingId') _buildingId: string,
    @Body() dto: ChangeBuildingStatusDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<BuildingResponse> {
    return this.buildings.changeStatus(scope, dto, requestContext(request));
  }

  @RequirePermissions(PERMISSIONS.BUILDING_READ)
  @Get('settings')
  @ApiOperation({ summary: 'مشاهده تنظیمات ساختمان' })
  async getSettings(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<BuildingSettingsResponse> {
    return this.buildings.getSettings(scope);
  }

  @RequirePermissions(PERMISSIONS.BUILDING_UPDATE)
  @Patch('settings')
  @ApiOperation({ summary: 'ویرایش تنظیمات ساختمان' })
  async updateSettings(
    @Param('buildingId') _buildingId: string,
    @Body() dto: UpdateBuildingSettingsDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<BuildingSettingsResponse> {
    return this.buildings.updateSettings(scope, dto, requestContext(request));
  }
}

/** Client metadata for the audit trail (BM-01 §38). */
function requestContext(request: Request) {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  };
}
