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
import { CreditsService } from './credits.service';
import {
  ApplyCreditDto,
  ListCreditsQueryDto,
  UnitStatementQueryDto,
  type ApplyCreditResponse,
  type UnitCreditResponse,
  type UnitStatementResponse,
} from './dto/payment.dto';

/**
 * Unit credit and unit statements — `/api/buildings/{id}/credits` and
 * `/api/buildings/{id}/units/{unitId}/statement` (BM-03 §26-§28, §54).
 *
 * WHY BOTH LIVE ON ONE CONTROLLER: they are two views of the same question —
 * what does this unit actually owe? The statement gives the ledger-derived
 * answer (§28); credits give the part of it that is money already received but
 * not yet matched to a document (§27). Splitting them would put one decision
 * behind two module boundaries.
 *
 * NO DELETE ON A CREDIT. Credit is money the resident handed over; removing the
 * row would make it disappear from the books while the ledger still shows it
 * received. Credit leaves only by being applied to an invoice, or by the
 * reversal of the payment that created it.
 *
 * PERMISSIONS: reading credits and statements takes LEDGER_READ — the same gate
 * as the books themselves, since a statement IS a ledger view. Applying credit
 * takes PAYMENT_RECORD: it settles a document, so it belongs with the people who
 * may record settlement and NOT with auditors (§62).
 *
 * A NOTE ON RESIDENT ACCESS (§54): residents hold OWN_LEDGER_READ, not
 * LEDGER_READ, and these routes require the latter — a resident reaching their
 * own statement through a `/me` route is BM-03's §54 surface and is deliberately
 * not this endpoint, because this one lists ANY unit in the building.
 */
@ApiTags('finance')
@Controller('buildings/:buildingId')
@ScopedTo('building')
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @RequirePermissions(PERMISSIONS.LEDGER_READ)
  @Get('credits')
  @ApiOperation({ summary: 'فهرست اعتبارهای واحدها' })
  async list(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Query() query: ListCreditsQueryDto,
  ): Promise<UnitCreditResponse[]> {
    return this.credits.list(scope, query);
  }

  /**
   * §27 — spends existing credit against an outstanding invoice.
   *
   * Takes no amount: the service applies the smaller of what the unit holds and
   * what the invoice owes. This is a settlement operation, not a ledger post —
   * see `credits.service.ts` for why applying credit records no new entry.
   */
  @RequirePermissions(PERMISSIONS.PAYMENT_RECORD)
  @Post('credits/apply')
  @ApiOperation({ summary: 'اعمال اعتبار واحد روی صورت‌حساب' })
  async apply(
    @Param('buildingId') _buildingId: string,
    @CurrentScope() scope: RequestScope,
    @Body() dto: ApplyCreditDto,
  ): Promise<ApplyCreditResponse> {
    return this.credits.apply(scope, dto);
  }

  /**
   * §28 — the unit's financial position, derived from ledger entries rather than
   * read from a stored balance column.
   */
  @RequirePermissions(PERMISSIONS.LEDGER_READ)
  @Get('units/:unitId/statement')
  @ApiOperation({ summary: 'صورت‌حساب و مانده واحد' })
  async statement(
    @Param('buildingId') _buildingId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @CurrentScope() scope: RequestScope,
    @Query() query: UnitStatementQueryDto,
  ): Promise<UnitStatementResponse> {
    return this.credits.statement(scope, unitId, { take: query.take });
  }
}
