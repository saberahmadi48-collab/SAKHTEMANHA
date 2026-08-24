import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Income } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantScopedRepository } from '../../core/database/tenant-scoped.repository';
import { LedgerService } from '../../core/finance/ledger.service';
import { toAmount, toDecimal } from '../../core/finance/money';
import { FinancialCategoriesService } from './financial-categories.service';
import { FinancialPeriodsService } from './financial-periods.service';
import type {
  BuildingFinancialSummaryQueryDto,
  BuildingFinancialSummaryResponse,
  IncomeResponse,
  ListIncomesQueryDto,
  RecordIncomeDto,
} from './dto/expense.dto';

/**
 * Building income recorded outside the charge pipeline, and the manager's
 * financial dashboard (BM-03 §41/§53).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS NOT: THE PLACE MONTHLY CHARGE INCOME LANDS.
 *
 * Charge income already reaches the books along Charge → Invoice → Payment,
 * where the payment posts a unit-level CREDIT. Mirroring it here would count the
 * same rial twice in every report the manager reads — and, worse, it would look
 * right, because both halves would be individually defensible.
 *
 * `IncomeSourceType` therefore has no CHARGE or INVOICE member. That absence is
 * the guard: there is no value a caller could send to file charge income here.
 * This model is for the rooftop antenna rent and the hall-hire fee — money with
 * no unit obligation behind it.
 *
 * UNLIKE AN EXPENSE, RECORDING INCOME POSTS IMMEDIATELY. There is no approval
 * chain because there is nothing to approve: the money is already in hand when
 * someone records it. An expense is a request to spend; income is a report that
 * cash arrived.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class IncomesService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly categories: FinancialCategoriesService,
    private readonly periods: FinancialPeriodsService,
  ) {
    super();
  }

  async list(
    scope: RequestScope,
    query: ListIncomesQueryDto = {},
  ): Promise<IncomeResponse[]> {
    const incomes = await this.prisma.income.findMany({
      where: {
        ...this.tenantWhere(scope),
        ...(query.sourceType ? { sourceType: query.sourceType } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.financialPeriodId
          ? { financialPeriodId: query.financialPeriodId }
          : {}),
      },
      include: { category: { select: { name: true } } },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    return incomes.map(toIncomeResponse);
  }

  /**
   * Records income and posts the building-level CREDIT in one transaction (§41).
   *
   * `unitId: null` for the same reason an expense is building-level: this money
   * belongs to the building, not to any resident, and crediting a unit here would
   * reduce that resident's charge obligation by the building's antenna rent.
   *
   * The row and the ledger entry commit together. A recorded income without its
   * entry is a reconciliation exception someone has to chase later (§61).
   */
  async record(
    scope: RequestScope,
    dto: RecordIncomeDto,
  ): Promise<IncomeResponse> {
    const category = await this.categories.resolveForEntry(
      scope,
      dto.categoryId,
      'INCOME',
    );

    const receivedAt = new Date(dto.receivedAt);
    const period = dto.financialPeriodId
      ? await this.periods.findOne(scope, dto.financialPeriodId)
      : await this.periods.ensurePeriodFor(scope, receivedAt);

    const created = await this.prisma.$transaction(async (tx) => {
      const income = await tx.income.create({
        data: {
          buildingId: scope.buildingId!,
          categoryId: category.id,
          financialPeriodId: period.id,
          amount: toDecimal(dto.amount),
          receivedAt,
          sourceType: dto.sourceType,
          referenceType: dto.referenceType?.trim() || null,
          referenceId: dto.referenceId?.trim() || null,
          description: dto.description.trim(),
          recordedByPersonId: scope.personId ?? null,
        },
        include: { category: { select: { name: true } } },
      });

      const entry = await this.ledger.post(tx, scope, {
        unitId: null,
        financialPeriodId: period.id,
        direction: 'CREDIT',
        amount: income.amount,
        referenceType: 'INCOME',
        referenceId: income.id,
        description: income.description,
        occurredAt: receivedAt,
        currency: income.currency,
      });

      const linked = await tx.income.update({
        where: { id: income.id },
        data: { ledgerEntryId: entry.id },
        include: { category: { select: { name: true } } },
      });

      await this.audit.logInTransaction(tx, scope, {
        action: 'finance.income.recorded',
        resourceType: 'Income',
        resourceId: income.id,
        after: {
          amount: toAmount(income.amount),
          sourceType: income.sourceType,
          categoryId: category.id,
          ledgerEntryId: entry.id,
        },
      });

      return linked;
    });

    return toIncomeResponse(created);
  }

  /**
   * The manager's financial position (§53).
   *
   * Every figure here is derived from the ledger or from expense status, never
   * from a stored running total — the same rule the rest of this module follows,
   * and what makes the dashboard recomputable from scratch.
   *
   * THREE DELIBERATE CHOICES, each of which changes what a manager decides:
   *
   *  - `expenseTotal` counts PAID expenses only. Money that has not left the
   *    account has not been spent, and treating an approved bill as spent would
   *    understate the balance available today.
   *
   *  - `pendingExpenseTotal` (APPROVED, not yet paid) is reported SEPARATELY and
   *    is NOT subtracted from `netPosition`. It is committed money the manager
   *    must see coming before spending the balance on something else, but it is
   *    still in the account, so netting it would misstate cash.
   *
   *  - `outstandingReceivable` sums UNIT-level entries only. Mixing building
   *    entries into it would let a paid supplier bill masquerade as resident
   *    debt, which is precisely the number a manager chases people for.
   */
  async summary(
    scope: RequestScope,
    query: BuildingFinancialSummaryQueryDto = {},
  ): Promise<BuildingFinancialSummaryResponse> {
    const periodFilter = query.financialPeriodId
      ? { financialPeriodId: query.financialPeriodId }
      : {};

    const [
      buildingCredits,
      unitGrouped,
      paidExpenses,
      pendingExpenses,
      statusCounts,
      unpaidUnits,
    ] = await Promise.all([
      // Building-level CREDITs: recorded income (§41).
      this.prisma.ledgerEntry.aggregate({
        where: {
          buildingId: scope.buildingId!,
          unitId: null,
          direction: 'CREDIT',
          ...periodFilter,
        },
        _sum: { amount: true },
      }),
      // Unit-level entries, split by direction. Collected charge income is the
      // CREDIT side; what residents still owe is DEBIT minus CREDIT.
      this.prisma.ledgerEntry.groupBy({
        by: ['direction'],
        where: {
          buildingId: scope.buildingId!,
          unitId: { not: null },
          ...periodFilter,
        },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          ...this.tenantWhere(scope),
          status: 'PAID',
          ...periodFilter,
        },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          ...this.tenantWhere(scope),
          status: 'APPROVED',
          ...periodFilter,
        },
        _sum: { amount: true },
      }),
      this.prisma.expense.groupBy({
        by: ['status'],
        where: { ...this.tenantWhere(scope), ...periodFilter },
        _count: { _all: true },
      }),
      this.prisma.invoice.findMany({
        where: {
          ...this.tenantWhere(scope),
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
          ...periodFilter,
        },
        select: { unitId: true },
        distinct: ['unitId'],
      }),
    ]);

    const zero = new Prisma.Decimal(0);
    const unitCredit =
      unitGrouped.find((row) => row.direction === 'CREDIT')?._sum.amount ?? zero;
    const unitDebit =
      unitGrouped.find((row) => row.direction === 'DEBIT')?._sum.amount ?? zero;

    // Collected income = money actually received: building CREDITs (recorded
    // income) plus unit CREDITs (settled resident payments). Deliberately NOT
    // what was invoiced — a dashboard showing billed-but-unpaid money as income
    // tells a manager they can afford a repair they cannot.
    const incomeTotal = (buildingCredits._sum.amount ?? zero).plus(unitCredit);
    const expenseTotal = paidExpenses._sum.amount ?? zero;

    return {
      financialPeriodId: query.financialPeriodId ?? null,
      currency: 'IRR',
      incomeTotal: toAmount(incomeTotal),
      expenseTotal: toAmount(expenseTotal),
      netPosition: toAmount(incomeTotal.minus(expenseTotal)),
      pendingExpenseTotal: toAmount(pendingExpenses._sum.amount ?? zero),
      outstandingReceivable: toAmount(unitDebit.minus(unitCredit)),
      unpaidUnitCount: unpaidUnits.length,
      expenseCountByStatus: Object.fromEntries(
        statusCounts.map((row) => [row.status, row._count._all]),
      ),
    };
  }

  async findOne(scope: RequestScope, incomeId: string): Promise<IncomeResponse> {
    const income = await this.prisma.income.findFirst({
      where: { id: incomeId, ...this.tenantWhere(scope) },
      include: { category: { select: { name: true } } },
    });
    if (!income) throw new NotFoundException(ERRORS.incomeNotFound);
    return toIncomeResponse(income);
  }
}

function toIncomeResponse(
  income: Income & { category?: { name: string } | null },
): IncomeResponse {
  return {
    id: income.id,
    categoryId: income.categoryId,
    categoryName: income.category?.name ?? null,
    financialPeriodId: income.financialPeriodId,
    amount: toAmount(income.amount),
    currency: income.currency,
    receivedAt: income.receivedAt.toISOString(),
    sourceType: income.sourceType,
    referenceType: income.referenceType,
    referenceId: income.referenceId,
    description: income.description,
    ledgerEntryId: income.ledgerEntryId,
    recordedByPersonId: income.recordedByPersonId,
    createdAt: income.createdAt.toISOString(),
  };
}
