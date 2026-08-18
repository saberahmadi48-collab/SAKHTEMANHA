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
import { UnitsService } from './units.service';
import {
  CreateUnitDto,
  GenerateUnitsDto,
  UpdateUnitDto,
  type GenerateUnitsResponse,
  type UnitResponse,
} from './dto/unit.dto';

/**
 * Unit endpoints, nested under their building — BM-01 §41
 * (`/api/buildings/{id}/units`).
 *
 * THE NESTING IS THE SECURITY MODEL, not a stylistic choice. Because every
 * route carries `:buildingId`, BuildingScopeGuard resolves and proves the
 * tenant before any handler runs, and the service filters every query by that
 * proven id. A flat `/api/units/{id}` would have to trust an id with no tenant
 * context attached — precisely the IDOR/BOLA hole §39 requires protection
 * against.
 *
 * `:unitId` is additionally parsed as a UUID so a malformed id fails with a
 * Persian 400 at the pipe rather than reaching Postgres as a type error.
 */
@ApiTags('units')
@Controller('buildings/:buildingId/units')
@ScopedTo('building')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @RequirePermissions(PERMISSIONS.UNIT_CREATE)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد واحد جدید در ساختمان' })
  async create(
    @Param('buildingId') _buildingId: string,
    @Body() dto: CreateUnitDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<UnitResponse> {
    return this.units.create(scope, dto, requestContext(request));
  }

  /**
   * Bulk-creates units from a floor plan (§32, §36).
   * Existing labels are skipped and reported, never overwritten.
   */
  @RequirePermissions(PERMISSIONS.UNIT_CREATE)
  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد گروهی واحدها بر اساس نقشه طبقات' })
  async generate(
    @Param('buildingId') _buildingId: string,
    @Body() dto: GenerateUnitsDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<GenerateUnitsResponse> {
    return this.units.generate(scope, dto, requestContext(request));
  }

  /**
   * Units of this building. `includeArchived=true` surfaces archived rows —
   * they still exist (§16), they are merely out of the default view.
   */
  @RequirePermissions(PERMISSIONS.UNIT_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست واحدهای ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<UnitResponse[]> {
    return this.units.list(scope, includeArchived === 'true');
  }

  @RequirePermissions(PERMISSIONS.UNIT_READ)
  @Get(':unitId')
  @ApiOperation({ summary: 'مشاهده اطلاعات واحد' })
  async findOne(
    @Param('buildingId') _buildingId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<UnitResponse> {
    return this.units.findOne(scope, unitId);
  }

  @RequirePermissions(PERMISSIONS.UNIT_UPDATE)
  @Patch(':unitId')
  @ApiOperation({ summary: 'ویرایش اطلاعات واحد' })
  async update(
    @Param('buildingId') _buildingId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() dto: UpdateUnitDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<UnitResponse> {
    return this.units.update(scope, unitId, dto, requestContext(request));
  }

  /**
   * Archives a unit (soft delete — §16, BM-00 rule 4).
   *
   * Deliberately a POST rather than DELETE: the HTTP verb should not suggest
   * the row goes away. Nothing in this platform hard-deletes a unit, and
   * PrismaService blocks it at the client level regardless.
   */
  @RequirePermissions(PERMISSIONS.UNIT_ARCHIVE)
  @Post(':unitId/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'بایگانی واحد' })
  async archive(
    @Param('buildingId') _buildingId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<UnitResponse> {
    return this.units.archive(scope, unitId, requestContext(request));
  }
}

/** Client metadata for the audit trail (BM-01 §38). */
function requestContext(request: Request) {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  };
}
