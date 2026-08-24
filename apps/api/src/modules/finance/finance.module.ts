import { Module } from '@nestjs/common';

import { LedgerService } from '../../core/finance/ledger.service';
import { ChargeGenerationController } from './charge-generation.controller';
import { ChargeGenerationService } from './charge-generation.service';
import { ChargeRulesController } from './charge-rules.controller';
import { ChargeRulesService } from './charge-rules.service';
import { CreditsController } from './credits.controller';
import { CreditsService } from './credits.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExtraordinaryChargesController } from './extraordinary-charges.controller';
import { FinancialCategoriesController } from './financial-categories.controller';
import { FinancialCategoriesService } from './financial-categories.service';
import { FinancialPeriodsController } from './financial-periods.controller';
import { FinancialPeriodsService } from './financial-periods.service';
import { IncomesController } from './incomes.controller';
import { IncomesService } from './incomes.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * BM-03 finance — the ledger, the accounting calendar, charge rules, monthly
 * charge generation and invoicing. Payment settlement lands in BM-04.
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
 *
 * NOTE ON `InvoicesService`: it does NOT depend on LedgerService, and that
 * absence is intentional rather than an oversight. Issuing an invoice records no
 * financial effect — the obligation was already posted when the charge was
 * generated — so a service that could post here would only ever be used to
 * double a resident's balance (§70: Charge ≠ Invoice ≠ Payment).
 *
 * THE SETTLEMENT PAIR, and why reading them apart is misleading:
 * `PaymentsService` posts the FULL amount received as a CREDIT — including the
 * part no invoice consumed — and records the excess as a UnitCredit.
 * `CreditsService` then spends that credit against later invoices WITHOUT
 * posting anything, because the money already hit the ledger when it arrived.
 * Neither half is correct alone: post twice and the resident is credited money
 * they never paid; post once but only the settled part and their overpayment
 * vanishes from the books. Change one and you must change the other in the same
 * commit.
 *
 * THE BUILDING SIDE OF THE BOOKS (§38-§42), added last and deliberately kept
 * separate from everything above it. Expenses and income post with
 * `unitId = null`, which is the line that stops a supplier bill from landing on
 * a resident's balance. A lift repair becomes a resident obligation ONLY through
 * the charge formula (§12) — never by being split across units at the point it
 * is paid, which would bill them for the same repair twice.
 *
 * `ExpensesService` posts to the ledger in exactly ONE method (`pay`). Approval
 * is a decision and writes nothing; if a later change makes `approve` post, the
 * building's balance will show money gone before it left the account.
 */
@Module({
  controllers: [
    FinancialPeriodsController,
    ChargeRulesController,
    ChargeGenerationController,
    ExtraordinaryChargesController,
    InvoicesController,
    PaymentsController,
    CreditsController,
    FinancialCategoriesController,
    ExpensesController,
    IncomesController,
  ],
  providers: [
    FinancialPeriodsService,
    ChargeRulesService,
    ChargeGenerationService,
    InvoicesService,
    PaymentsService,
    CreditsService,
    FinancialCategoriesService,
    ExpensesService,
    IncomesService,
    LedgerService,
  ],
  exports: [
    FinancialPeriodsService,
    ChargeRulesService,
    ChargeGenerationService,
    InvoicesService,
    PaymentsService,
    CreditsService,
    FinancialCategoriesService,
    ExpensesService,
    IncomesService,
    LedgerService,
  ],
})
export class FinanceModule {}
