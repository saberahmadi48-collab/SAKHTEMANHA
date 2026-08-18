import { Module } from '@nestjs/common';

import { LedgerService } from '../../core/finance/ledger.service';
import { FinancialPeriodsController } from './financial-periods.controller';
import { FinancialPeriodsService } from './financial-periods.service';

/**
 * BM-03 finance — the ledger, the accounting calendar, and (in later slices)
 * charge generation, invoicing and payment settlement.
 *
 * FIRST SLICE SCOPE: financial periods plus the ledger core. Charge rules,
 * generation and invoicing build on exactly these two, so they land first and
 * are proven before anything writes an invoice a resident will see.
 *
 * `LedgerService` is provided AND exported here rather than living in
 * CoreModule: it is the single writer of `ledger_entries` (§7), and keeping the
 * one place that can create financial effects inside the finance module makes
 * that boundary visible. Any future module needing to post — payments,
 * expenses — imports FinanceModule and goes through this service, which is what
 * keeps the append-only and closed-period rules true system-wide.
 */
@Module({
  controllers: [FinancialPeriodsController],
  providers: [FinancialPeriodsService, LedgerService],
  exports: [FinancialPeriodsService, LedgerService],
})
export class FinanceModule {}
