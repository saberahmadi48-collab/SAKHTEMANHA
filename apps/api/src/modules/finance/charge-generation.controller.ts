import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestScope } from '@bops/contracts';

import {
  CurrentScope,
  RequirePermissions,
  ScopedTo,
} from '../../core/authorization/authorization.decorators';
import { ChargeGenerationService } from './charge-generation.service';
import {
  GenerateChargesDto,
  type ChargeRunResponse,
} from './dto/charge-generation.dto';

/**
 * Monthly charge generation — `/api/buildings/{id}/charge-runs` (BM-03 §50/§51).
 *
 * THE RESOURCE IS THE RUN, NOT THE CHARGES, and that shape is deliberate. A
 * `POST /charges` that took a unit and an amount would be the manual data entry
 * §2 exists to abolish; posting a RUN says "execute the configured rules for
 * this month", which is the only operation a manager should have. The charges
 * themselves are an outcome, read through the ledger and (next slice) invoices.
 *
 * WHY `POST` IS THE SAFE VERB HERE even though the operation must not repeat:
 * idempotency is enforced in the DATABASE, not by the verb. A second run hits
 * the `charge_runs` unique on (buildingId, financialPeriodId) and comes back as
 * a Persian 409 (§51) — the double-click the manager will eventually make
 * cannot bill anyone twice.
 *
 * PERMISSIONS: CHARGE_CREATE to run, CHARGE_READ to look at history. AUDITOR
 * holds neither of the write permissions by design.
 */
@ApiTags('finance')
@Controller('buildings/:buildingId/charge-runs')
@ScopedTo('building')
export class ChargeGenerationController {
  constructor(private readonly generation: ChargeGenerationService) {}

  /** The "was this month generated?" history, newest first. */
  @RequirePermissions(PERMISSIONS.CHARGE_READ)
  @Get()
  @ApiOperation({ summary: 'تاریخچه اجراهای صدور شارژ' })
  async list(@CurrentScope() scope: RequestScope): Promise<ChargeRunResponse[]> {
    return this.generation.listRuns(scope);
  }

  /**
   * Runs the configured rules for one period and writes charges plus their
   * ledger effects — all in one transaction, so the month is either fully
   * generated or not at all.
   */
  @RequirePermissions(PERMISSIONS.CHARGE_CREATE)
  @Post()
  @ApiOperation({ summary: 'صدور شارژ ماهانه بر پایه قوانین فعال' })
  async generate(
    @CurrentScope() scope: RequestScope,
    @Body() dto: GenerateChargesDto,
  ): Promise<ChargeRunResponse> {
    return this.generation.generate(scope, dto);
  }
}
