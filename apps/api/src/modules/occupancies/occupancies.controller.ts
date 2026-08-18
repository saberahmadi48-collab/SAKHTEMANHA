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
import { OccupanciesService } from './occupancies.service';
import {
  CreateOccupancyDto,
  MoveInDto,
  MoveOutDto,
  UpdateOccupancyDto,
  type OccupancyMoveResponse,
  type OccupancyResponse,
} from './dto/occupancy.dto';

/**
 * Unit occupancy — `/api/buildings/{id}/occupancies` (BM-01 §20).
 *
 * Nested under `:buildingId` like every other unit-scoped resource, so the guard
 * proves the tenant from the URL before any handler runs and an occupancy id
 * from another building is unreachable from here.
 *
 * NOTE THE PERMISSION ASYMMETRY WITH OWNERSHIP. OWNER holds OWNERSHIP_READ but
 * NOT OCCUPANCY_READ: knowing who holds title to the flat you co-own is
 * reasonable, while a directory of who physically lives where is exactly the
 * surveillance surface BM-00 rule 6 is written against. Occupancy reading sits
 * with BUILDING_MANAGER, BOARD_MEMBER and AUDITOR.
 *
 * THERE IS NO DELETE. A period ENDS via move-out; the row stays, because last
 * winter's heating bill was split by who lived there then (R2, BM-03).
 */
@ApiTags('occupancies')
@Controller('buildings/:buildingId/occupancies')
@ScopedTo('building')
export class OccupanciesController {
  constructor(private readonly occupancies: OccupanciesService) {}

  /**
   * Occupancy periods, newest first. Closed periods included by design.
   *
   * `current=true` narrows to periods in force right now — derived from the
   * interval rather than a stored flag, so it cannot disagree with the data.
   */
  @RequirePermissions(PERMISSIONS.OCCUPANCY_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست دوره‌های سکونت ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query('unitId') unitId?: string,
    @Query('personId') personId?: string,
    @Query('current') current?: string,
  ): Promise<OccupancyResponse[]> {
    return this.occupancies.list(scope, {
      unitId,
      personId,
      currentOnly: current === 'true',
    });
  }

  @RequirePermissions(PERMISSIONS.OCCUPANCY_READ)
  @Get(':occupancyId')
  @ApiOperation({ summary: 'جزئیات یک دوره سکونت' })
  async findOne(
    @Param('buildingId') _buildingId: string,
    @Param('occupancyId', ParseUUIDPipe) occupancyId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<OccupancyResponse> {
    return this.occupancies.findOne(scope, occupancyId);
  }

  /** Opens an occupancy period. Refuses if the window is already occupied. */
  @RequirePermissions(PERMISSIONS.OCCUPANCY_MANAGE)
  @Post()
  @ApiOperation({ summary: 'ثبت سکونت جدید برای یک واحد' })
  async create(
    @Param('buildingId') _buildingId: string,
    @Body() dto: CreateOccupancyDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<OccupancyResponse> {
    return this.occupancies.create(scope, dto, requestContext(request));
  }

  /**
   * Moves someone in: closes the sitting occupancy and opens the new one at the
   * same instant, in one transaction.
   *
   * Declared before `:occupancyId` on purpose — Nest matches routes in
   * declaration order, and a later `move-in` would be swallowed by the uuid
   * param route.
   */
  @RequirePermissions(PERMISSIONS.OCCUPANCY_MANAGE)
  @Post('move-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'اسکان ساکن جدید در واحد' })
  async moveIn(
    @Param('buildingId') _buildingId: string,
    @Body() dto: MoveInDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<OccupancyMoveResponse> {
    return this.occupancies.moveIn(scope, dto, requestContext(request));
  }

  /** Corrects an OPEN period. Closed ones refuse every edit (R2). */
  @RequirePermissions(PERMISSIONS.OCCUPANCY_MANAGE)
  @Patch(':occupancyId')
  @ApiOperation({ summary: 'اصلاح دوره سکونت باز' })
  async update(
    @Param('buildingId') _buildingId: string,
    @Param('occupancyId', ParseUUIDPipe) occupancyId: string,
    @Body() dto: UpdateOccupancyDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<OccupancyResponse> {
    return this.occupancies.update(
      scope,
      occupancyId,
      dto,
      requestContext(request),
    );
  }

  /** Ends an open period — optionally leaving a VACANT period behind it. */
  @RequirePermissions(PERMISSIONS.OCCUPANCY_MANAGE)
  @Post(':occupancyId/move-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ثبت تخلیه واحد' })
  async moveOut(
    @Param('buildingId') _buildingId: string,
    @Param('occupancyId', ParseUUIDPipe) occupancyId: string,
    @Body() dto: MoveOutDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<OccupancyResponse> {
    return this.occupancies.moveOut(
      scope,
      occupancyId,
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
