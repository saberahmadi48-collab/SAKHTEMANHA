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
import { ManagementTermsService } from './management-terms.service';
import {
  ActivateManagementTermDto,
  CompleteManagementTermDto,
  CreateManagementTermDto,
  TerminateManagementTermDto,
  UpdateManagementTermDto,
  type ManagementTermResponse,
} from './dto/management-term.dto';

/**
 * Management terms — `/api/buildings/{id}/management-terms` (BM-01 §25/§26).
 *
 * Nested under `:buildingId` like units and members, so the guard proves the
 * tenant from the URL before any handler runs and a term id from another
 * building is simply unreachable from here.
 *
 * THE PERMISSION SPLIT IS THE POINT. Reading terms sits in RESIDENT_BASE —
 * every resident may know who governs their building. But TERM_CREATE and
 * TERM_TERMINATE are deliberately withheld from BUILDING_MANAGER in the role
 * matrix and held at the organization tier: an elected officeholder who could
 * schedule their own next term, or terminate the term that bounds their
 * mandate, would be permanent in all but name — the exact inversion of
 * BM-00 rule 1.
 *
 * THERE IS NO DELETE. A term is COMPLETED or TERMINATED, never removed: the
 * record of who governed between which dates is what a later dispute is
 * settled with (R2).
 */
@ApiTags('management-terms')
@Controller('buildings/:buildingId/management-terms')
@ScopedTo('building')
export class ManagementTermsController {
  constructor(private readonly terms: ManagementTermsService) {}

  /** Full term history, newest first. Closed terms included by design. */
  @RequirePermissions(PERMISSIONS.TERM_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست دوره‌های مدیریت ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<ManagementTermResponse[]> {
    return this.terms.list(scope);
  }

  /**
   * The term governing right now, or null.
   *
   * Declared before `:termId` on purpose — Nest matches routes in declaration
   * order, and a later `current` would be swallowed by the uuid param route.
   */
  @RequirePermissions(PERMISSIONS.TERM_READ)
  @Get('current')
  @ApiOperation({ summary: 'دوره مدیریت جاری' })
  async current(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<ManagementTermResponse | null> {
    return this.terms.current(scope);
  }

  @RequirePermissions(PERMISSIONS.TERM_READ)
  @Get(':termId')
  @ApiOperation({ summary: 'جزئیات یک دوره مدیریت' })
  async findOne(
    @Param('buildingId') _buildingId: string,
    @Param('termId', ParseUUIDPipe) termId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<ManagementTermResponse> {
    return this.terms.findOne(scope, termId);
  }

  /** Schedules a term. Created SCHEDULED — activation is a separate act. */
  @RequirePermissions(PERMISSIONS.TERM_CREATE)
  @Post()
  @ApiOperation({ summary: 'ثبت دوره مدیریت جدید' })
  async create(
    @Param('buildingId') _buildingId: string,
    @Body() dto: CreateManagementTermDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<ManagementTermResponse> {
    return this.terms.create(scope, dto, requestContext(request));
  }

  @RequirePermissions(PERMISSIONS.TERM_UPDATE)
  @Patch(':termId')
  @ApiOperation({ summary: 'ویرایش دوره مدیریت' })
  async update(
    @Param('buildingId') _buildingId: string,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body() dto: UpdateManagementTermDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<ManagementTermResponse> {
    return this.terms.update(scope, termId, dto, requestContext(request));
  }

  /**
   * Puts a scheduled term into force — the moment authority transfers.
   *
   * Requires TERM_UPDATE rather than TERM_CREATE because it changes an existing
   * term's standing; the service additionally refuses to displace a governing
   * term unless the caller says so explicitly.
   */
  @RequirePermissions(PERMISSIONS.TERM_UPDATE)
  @Post(':termId/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'فعال‌سازی دوره مدیریت' })
  async activate(
    @Param('buildingId') _buildingId: string,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body() dto: ActivateManagementTermDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<ManagementTermResponse> {
    return this.terms.activate(scope, termId, dto, requestContext(request));
  }

  /** Closes a term normally — the mandate ran its course. */
  @RequirePermissions(PERMISSIONS.TERM_UPDATE)
  @Post(':termId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'پایان عادی دوره مدیریت' })
  async complete(
    @Param('buildingId') _buildingId: string,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body() dto: CompleteManagementTermDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<ManagementTermResponse> {
    return this.terms.complete(scope, termId, dto, requestContext(request));
  }

  /**
   * Ends a term early, with a required reason.
   *
   * TERM_TERMINATE is the narrowest permission in the governance set and is not
   * granted to BUILDING_MANAGER — removing an officeholder is an organization
   * act, not something the officeholder can do to their own mandate.
   */
  @RequirePermissions(PERMISSIONS.TERM_TERMINATE)
  @Post(':termId/terminate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'خاتمه دادن به دوره مدیریت' })
  async terminate(
    @Param('buildingId') _buildingId: string,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body() dto: TerminateManagementTermDto,
    @CurrentScope() scope: RequestScope,
    @Req() request: Request,
  ): Promise<ManagementTermResponse> {
    return this.terms.terminate(scope, termId, dto, requestContext(request));
  }
}

/** Client metadata for the audit trail (BM-01 §38). */
function requestContext(request: Request) {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  };
}
