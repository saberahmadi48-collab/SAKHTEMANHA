import { Module } from '@nestjs/common';

import { LedgerService } from '../../core/finance/ledger.service';
import { ChargeGenerationController } from './charge-generation.controller';
import { ChargeGenerationService } from './charge-generation.service';
import { ChargeRulesController } from './charge-rules.controller';
import { ChargeRulesService } from './charge-rules.service';
import { FinancialPeriodsController } from './financial-periods.controller';
import { FinancialPeriodsService } from './financial-periods.service';

/**
 * BM-03 finance — the ledger, the accounting calendar, charge rules and monthly
 * charge generation. Invoicing and payment settlement land in a later slice.
 *
 * SLICE ORDER, and why it is this way: periods plus the ledger core first, then
 * rules and generation on top of them. Generation is the operation that writes
 * numbers a resident will dispute, so everything it stands on — the append-only
 * ledger, the closed-period rule, the pure calculation engine — was proven
 * against a real database before it existed.
 *
 * WHY GENERATION LIVES BESIDE THE RULES rather than in its own module: it is
 * the only consumer of `ChargeRulesService.rulesInForce`, and that method is the
 * seam where "which formula was in force during Mehr" gets decided. Splitting
 * them would run a module boundary straight through one decision.
 *
 * `LedgerService` is provided AND exported here rather than living in
 * CoreModule: it is the single writer of `ledger_entries` (§7), and keeping the
 * one place that can create financial effects inside the finance module makes
 * that boundary visible. Any future module needing to post — payments,
 * expenses — imports FinanceModule and goes through this service, which is what
 * keeps the append-only and closed-period rules true system-wide.
 */
@Module({
  controllers: [
    FinancialPeriodsController,
    ChargeRulesController,
    ChargeGenerationController,
  ],
  providers: [
    FinancialPeriodsService,
    ChargeRulesService,
    ChargeGenerationService,
    LedgerService,
  ],
  exports: [
    FinancialPeriodsService,
    ChargeRulesService,
    ChargeGenerationService,
    LedgerService,
  ],
})
export class FinanceModule {}
