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
import { IncomesService } from './incomes.service';
import {
  BuildingFinancialSummaryQueryDto,
  ListIncomesQueryDto,
  RecordIncomeDto,
  type BuildingFinancialSummaryResponse,
  type IncomeResponse,
} from './dto/expense.dto';

/**
 * Building income and the manager's financial dashboard —
 * `/api/buildings/{id}/incomes` and `/api/buildings/{id}/financial-summary`
 * (BM-03 §41/§53).
 *
 * WHY THE SUMMARY LIVES HERE: it is the other half of the same question income
 * answers — what came in, what went out, where does the building stand. Putting
 * it on its own controller would separate the dashboard from the service that
 * computes it without buying anything.
 *
 * NO UPDATE AND NO DELETE ON AN INCOME. Recording income posts a ledger CREDIT
 * immediately, so the row is a transaction, not a draft (§70). A mistaken income
 * is corrected by reversing its ledger entry, which leaves both the error and the
 * correction visible — editing the row would silently change a figure an auditor
 * may already have signed off.
 *
 * PERMISSIONS: recording takes INCOME_RECORD, which the board and AUDITOR do not
 * hold — an auditor who can inject income into the books they audit is not an
 * auditor (§62). Reading the summary takes LEDGER_READ, because every figure in
 * it is derived from the ledger.
 */
@ApiTags('finance')
@Controller('buildings/:buildingId')
@ScopedTo('building')
export class IncomesController {
  constructor(private readonly incomes: IncomesService) {}

  @RequirePermissions(PERMISSIONS.INCOME_READ)
  @Get('incomes')
  @ApiOperation({ summary: 'فهرست درآمدهای ساختمان' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query() query: ListIncomesQueryDto,
  ): Promise<IncomeResponse[]> {
    return this.incomes.list(scope, query);
  }

  /**
   * §41 — records income received outside the charge pipeline and posts the
   * building-level CREDIT in the same transaction. There is no approval step:
   * the money is already in hand when someone records it.
   */
  @RequirePermissions(PERMISSIONS.INCOME_RECORD)
  @Post('incomes')
  @ApiOperation({ summary: 'ثبت درآمد ساختمان' })
  async record(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: RecordIncomeDto,
  ): Promise<IncomeResponse> {
    return this.incomes.record(scope, dto);
  }

  @RequirePermissions(PERMISSIONS.INCOME_READ)
  @Get('incomes/:incomeId')
  @ApiOperation({ summary: 'مشاهده یک درآمد' })
  async findOne(
    @Param('buildingId') _buildingId: string,
    @Param('incomeId', ParseUUIDPipe) incomeId: string,
    @CurrentScope() scope: RequestScope,
  ): Promise<IncomeResponse> {
    return this.incomes.findOne(scope, incomeId);
  }

  /**
   * §53 — the manager dashboard figures, every one derived from the ledger or
   * from expense status rather than from a stored running total.
   */
  @RequirePermissions(PERMISSIONS.LEDGER_READ)
  @Get('financial-summary')
  @ApiOperation({ summary: 'خلاصه وضعیت مالی ساختمان' })
  async summary(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query() query: BuildingFinancialSummaryQueryDto,
  ): Promise<BuildingFinancialSummaryResponse> {
    return this.incomes.summary(scope, query);
  }
}
