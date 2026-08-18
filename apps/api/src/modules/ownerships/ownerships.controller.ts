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
import { OwnershipsService } from './ownerships.service';
import {
  CloseOwnershipDto,
  CreateOwnershipDto,
  TransferOwnershipDto,
  UpdateOwnershipDto,
  type OwnershipResponse,
  type OwnershipTransferResponse,
} from './dto/ownership.dto';

/**
 * Unit ownership — `/api/buildings/{id}/ownerships` (BM-01 §18/§19).
 *
 * Nested under `:buildingId` like units, members and terms, so the guard proves
 * the tenant from the URL before any handler runs and an ownership id from
 * another building is simply unreachable from here.
 *
 * THE PERMISSION SPLIT IS THE POINT. OWNERSHIP_READ is held by OWNER,
 * BOARD_MEMBER and AUDITOR — a resident may see who holds title in their own
 * building. OWNERSHIP_MANAGE is held only by BUILDING_MANAGER and the
 * organization tier: recording a sale is a registry act, not something an owner
 * does to their own record.
 *
 * THERE IS NO DELETE. A period is CLOSED or corrected while open; the row is
 * never removed, because a charge raised last spring must stay attributable to
 * whoever actually held title that month (R2, BM-03).
 */
@ApiTags('ownerships')
@Controller('buildings/:buildingId/ownerships')
@ScopedTo('building')
export class OwnershipsController {
  constructor(private readonly ownerships: OwnershipsService) {}

  /**
   * Title periods, newest first. Closed periods included by design.
   *
   * `current=true` narrows to periods in force right now — derived from the
   * interval rather than a stored flag, so it cannot disagree with the data.
   */
  @RequirePermissions(PERMISSIONS.OWNERSHIP_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست دوره‌های مالکیت ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query('unitId') unitId?: string,
    @Query('personId') personId?: string,
    @Query('current') current?: string,
  ): Promise<OwnershipResponse[]> {
    return this.ownerships.list(scope, {
      unitId,
      personId,
      currentOnly: current === 'true',
    });
  }

  @RequirePermissions(PERMISSIONS.OWNERSHIP_READ)
  @Get(':ownershipId')
  @ApiOperation({ summary: 'جزئیات یک دوره مالکیت' })
  async findOne(
    @Param('buildingId') _buildingId: string,
    @Param('ownershipId', ParseUUIDPipe) ownershipId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<OwnershipResponse> {
    return this.ownerships.findOne(scope, ownershipId);
  }

  /** Opens a title period. Joint ownership = several periods, one per holder. */
  @RequirePermissions(PERMISSIONS.OWNERSHIP_MANAGE)
  @Post()
  @ApiOperation({ summary: 'ثبت مالکیت جدید برای یک واحد' })
  async create(
    @Param('buildingId') _buildingId: string,
    @Body() dto: CreateOwnershipDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<OwnershipResponse> {
    return this.ownerships.create(scope, dto, requestContext(request));
  }

  /**
   * Records a sale: closes the seller's period and opens the buyer's at the
   * same instant, in one transaction.
   *
   * Declared before `:ownershipId` on purpose — Nest matches routes in
   * declaration order, and a later `transfer` would be swallowed by the uuid
   * param route.
   */
  @RequirePermissions(PERMISSIONS.OWNERSHIP_MANAGE)
  @Post('transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'انتقال مالکیت واحد' })
  async transfer(
    @Param('buildingId') _buildingId: string,
    @Body() dto: TransferOwnershipDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<OwnershipTransferResponse> {
    return this.ownerships.transfer(scope, dto, requestContext(request));
  }

  /** Corrects an OPEN period. Closed ones refuse every edit (R2). */
  @RequirePermissions(PERMISSIONS.OWNERSHIP_MANAGE)
  @Patch(':ownershipId')
  @ApiOperation({ summary: 'اصلاح دوره مالکیت باز' })
  async update(
    @Param('buildingId') _buildingId: string,
    @Param('ownershipId', ParseUUIDPipe) ownershipId: string,
    @Body() dto: UpdateOwnershipDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<OwnershipResponse> {
    return this.ownerships.update(scope, ownershipId, dto, requestContext(request));
  }

  /** Ends an open period — the nearest thing to a delete, and deliberately not one. */
  @RequirePermissions(PERMISSIONS.OWNERSHIP_MANAGE)
  @Post(':ownershipId/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'پایان دادن به دوره مالکیت' })
  async close(
    @Param('buildingId') _buildingId: string,
    @Param('ownershipId', ParseUUIDPipe) ownershipId: string,
    @Body() dto: CloseOwnershipDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<OwnershipResponse> {
    return this.ownerships.close(scope, ownershipId, dto, requestContext(request));
  }
}

/** Client metadata for the audit trail (BM-01 §38). */
function requestContext(request: Request) {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  };
}
