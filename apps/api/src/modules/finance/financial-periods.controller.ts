import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestScope } from '@bops/contracts';

import {
  CurrentScope,
  RequirePermissions,
  ScopedTo,
} from '../../core/authorization/authorization.decorators';
import { FinancialPeriodsService } from './financial-periods.service';
import {
  CloseFinancialPeriodDto,
  CreateFinancialPeriodDto,
  ReopenFinancialPeriodDto,
  type FinancialPeriodResponse,
} from './dto/financial-period.dto';

/**
 * Financial periods — `/api/buildings/{id}/financial-periods` (BM-03 §9/§10).
 *
 * Nested under `:buildingId` like every other building resource, so
 * BuildingScopeGuard proves the tenant from the URL before a handler runs and a
 * period id from another building is unreachable (§64).
 *
 * PERMISSION SHAPE, and why it is asymmetric:
 *  - Reading uses LEDGER_READ: managers, board, auditors and the org tier.
 *  - Closing uses INVOICE_ISSUE — an operational finance act.
 *  - REOPENING uses CHARGE_ADJUST, which the AUDITOR role deliberately does NOT
 *    hold. §10 calls for "elevated permission", and an auditor who can unseal
 *    the books they audit is not an auditor.
 *
 * THERE IS NO DELETE, and no PATCH of the boundaries. A period is opened,
 * closed, and — with a reason on the record — reopened. Editing when a month
 * began would silently move charges between months.
 */
@ApiTags('finance')
@Controller('buildings/:buildingId/financial-periods')
@ScopedTo('building')
export class FinancialPeriodsController {
  constructor(private readonly periods: FinancialPeriodsService) {}

  @RequirePermissions(PERMISSIONS.LEDGER_READ)
  @Get()
  @ApiOperation({ summary: 'فهرست دوره‌های مالی ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query('year') year?: string,
  ): Promise<FinancialPeriodResponse[]> {
    return this.periods.list(scope, {
      year: year ? Number(year) : undefined,
    });
  }

  /**
   * The period covering right now. Returns null rather than 404 when the month
   * has not been opened yet — "no period yet" is a normal state the dashboard
   * renders, not an error.
   */
  @RequirePermissions(PERMISSIONS.LEDGER_READ)
  @Get('current')
  @ApiOperation({ summary: 'دوره مالی جاری' })
  async current(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<FinancialPeriodResponse | null> {
    const period = await this.periods.findCurrent(scope);
    return period ? this.periods.findOne(scope, period.id) : null;
  }

  @RequirePermissions(PERMISSIONS.LEDGER_READ)
  @Get(':periodId')
  @ApiOperation({ summary: 'جزئیات یک دوره مالی' })
  async findOne(
    @Param('buildingId') _buildingId: string,
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<FinancialPeriodResponse> {
    return this.periods.findOne(scope, periodId);
  }

  @RequirePermissions(PERMISSIONS.INVOICE_ISSUE)
  @Post()
  @ApiOperation({ summary: 'باز کردن دوره مالی تازه' })
  async create(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: CreateFinancialPeriodDto,
  ): Promise<FinancialPeriodResponse> {
    return this.periods.create(scope, dto);
  }

  @RequirePermissions(PERMISSIONS.INVOICE_ISSUE)
  @Post(':periodId/close')
  @ApiOperation({ summary: 'بستن دوره مالی' })
  async close(
    @Param('buildingId') _buildingId: string,
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: CloseFinancialPeriodDto,
  ): Promise<FinancialPeriodResponse> {
    return this.periods.close(scope, periodId, dto);
  }

  /** §10 — elevated permission plus a recorded reason. */
  @RequirePermissions(PERMISSIONS.CHARGE_ADJUST)
  @Post(':periodId/reopen')
  @ApiOperation({ summary: 'بازگشایی دوره مالی بسته‌شده' })
  async reopen(
    @Param('buildingId') _buildingId: string,
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: ReopenFinancialPeriodDto,
  ): Promise<FinancialPeriodResponse> {
    return this.periods.reopen(scope, periodId, dto);
  }
}
