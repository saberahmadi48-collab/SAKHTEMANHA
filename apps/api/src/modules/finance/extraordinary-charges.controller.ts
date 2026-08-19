import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestScope } from '@bops/contracts';

import {
  CurrentScope,
  RequirePermissions,
  ScopedTo,
} from '../../core/authorization/authorization.decorators';
import { ChargeGenerationService } from './charge-generation.service';
import {
  CreateExtraordinaryChargeDto,
  type ExtraordinaryChargeResponse,
} from './dto/extraordinary-charge.dto';

/**
 * Extraordinary charges — `/api/buildings/{id}/extraordinary-charges` (§20).
 *
 * A SEPARATE RESOURCE FROM `charge-runs` on purpose. A run executes the standing
 * configuration for a month and must happen at most once (§51); an extraordinary
 * levy is a one-off decision that a building may legitimately take twice in the
 * same month — a lift replacement in Mehr and an emergency roof repair in the
 * same Mehr are two real charges, not a duplicate. Folding them into one
 * endpoint would force one of those two truths to bend.
 *
 * Reading is deliberately absent here: the resulting charges are ordinary
 * charges, read through the ledger and the invoices they land on. A parallel
 * read surface would be a second answer to "what does this unit owe?", and §7
 * allows only one.
 *
 * PERMISSIONS: CHARGE_CREATE — the same authority as configuring a rule. AUDITOR
 * deliberately does not hold it; an auditor who can levy a charge is not
 * auditing one.
 */
@ApiTags('finance')
@Controller('buildings/:buildingId/extraordinary-charges')
@ScopedTo('building')
export class ExtraordinaryChargesController {
  constructor(private readonly generation: ChargeGenerationService) {}

  /**
   * Levies a one-off charge across the eligible units, with the reason and
   * approval reference §20 requires recorded on every resulting charge and in
   * the audit trail.
   */
  @RequirePermissions(PERMISSIONS.CHARGE_CREATE)
  @Post()
  @ApiOperation({ summary: 'ثبت شارژ فوق‌العاده با دلیل الزامی' })
  async create(
    @CurrentScope() scope: RequestScope,
    @Body() dto: CreateExtraordinaryChargeDto,
  ): Promise<ExtraordinaryChargeResponse> {
    return this.generation.createExtraordinary(scope, dto);
  }
}
