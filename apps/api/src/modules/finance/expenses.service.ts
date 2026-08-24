import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Expense } from '@prisma/client';
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
  CreateExpenseDto,
  ExpenseResponse,
  ListExpensesQueryDto,
  PayExpenseDto,
  RejectExpenseDto,
  UpdateExpenseDto,
} from './dto/expense.dto';

/**
 * Building expenses and their approval chain (BM-03 §38/§39/§40).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO INVARIANTS. Break either and the building's books stop meaning anything.
 *
 * 1. THE LEDGER IS TOUCHED EXACTLY ONCE, IN `pay`, AND NOWHERE ELSE.
 *    Not on create, not on submit, not on approve. Approving is a DECISION;
 *    paying is a FINANCIAL EVENT, and §40 keeps them apart deliberately.
 *    Posting at approval would show money gone while it is still in the
 *    account — a manager reading the balance would under-spend by every
 *    approved-but-unpaid bill. Posting at both would double every supplier
 *    invoice. `ledgerEntryId` is null until PAID, which makes the rule
 *    inspectable in the data rather than only in this comment.
 *
 * 2. AN EXPENSE IS A BUILDING-LEVEL DEBIT (`unitId: null`) AND NEVER TOUCHES A
 *    UNIT BALANCE. The temptation is to split a 12,000,000 lift repair across
 *    the units right here. That would bill residents TWICE: once directly, and
 *    again next month when the charge formula (§12) turns building costs into
 *    resident obligations through the rule engine. The expense is what the
 *    BUILDING spent; the charge is what a RESIDENT owes. §70's
 *    "Charge ≠ Invoice ≠ Payment" extends to this boundary too.
 *
 * SEPARATION OF DUTIES (§39/§63): the person who entered an expense cannot
 * approve it, enforced in `approve` and NOT merely by the permission matrix.
 * The matrix denies BUILDING_MANAGER the approve permission, but an ORG_ADMIN
 * legitimately holds both — the check below is what stops that one account from
 * being an unchecked spender.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class ExpensesService extends TenantScopedRepository {
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
    query: ListExpensesQueryDto = {},
  ): Promise<ExpenseResponse[]> {
    const expenses = await this.prisma.expense.findMany({
      where: {
        ...this.tenantWhere(scope),
        ...(query.status ? { status: query.status } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.financialPeriodId
          ? { financialPeriodId: query.financialPeriodId }
          : {}),
      },
      include: { category: { select: { name: true } } },
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    return expenses.map(toExpenseResponse);
  }

  async findOne(
    scope: RequestScope,
    expenseId: string,
  ): Promise<ExpenseResponse> {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, ...this.tenantWhere(scope) },
      include: { category: { select: { name: true } } },
    });
    if (!expense) throw new NotFoundException(ERRORS.expenseNotFound);
    return toExpenseResponse(expense);
  }

  /**
   * Enters a supplier bill as a DRAFT (§38). No financial effect at all.
   *
   * The period is resolved from `expenseDate` so the cost is accounted to the
   * month it belongs to, not the month someone got round to typing it in. It is
   * nullable and re-resolved at payment time — see `pay`.
   */
  async create(
    scope: RequestScope,
    dto: CreateExpenseDto,
  ): Promise<ExpenseResponse> {
    const category = await this.categories.resolveForEntry(
      scope,
      dto.categoryId,
      'EXPENSE',
    );

    const expenseDate = new Date(dto.expenseDate);
    const period = await this.periods.ensurePeriodFor(scope, expenseDate);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const expense = await tx.expense.create({
          data: {
            buildingId: scope.buildingId!,
            categoryId: category.id,
            financialPeriodId: period.id,
            vendorName: dto.vendorName.trim(),
            description: dto.description.trim(),
            invoiceReference: dto.invoiceReference?.trim() || null,
            amount: toDecimal(dto.amount),
            expenseDate,
            status: 'DRAFT',
            createdByPersonId: scope.personId ?? null,
          },
          include: { category: { select: { name: true } } },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'finance.expense.created',
          resourceType: 'Expense',
          resourceId: expense.id,
          after: {
            vendorName: expense.vendorName,
            amount: toAmount(expense.amount),
            categoryId: category.id,
          },
        });

        return expense;
      });

      return toExpenseResponse(created);
    } catch (error) {
      // The (buildingId, vendorName, invoiceReference) unique. A duplicate here
      // is the building about to pay the same contractor invoice twice, which is
      // exactly what §38's document reference exists to prevent.
      if (isDuplicateReference(error)) {
        throw new ConflictException(ERRORS.duplicateExpenseReference);
      }
      throw error;
    }
  }

  /** Edits a DRAFT. Refused afterwards — an approver reviewed specific figures. */
  async update(
    scope: RequestScope,
    expenseId: string,
    dto: UpdateExpenseDto,
  ): Promise<ExpenseResponse> {
    const existing = await this.load(scope, expenseId);
    this.assertStatus(existing, 'DRAFT', ERRORS.expenseNotDraft);

    const categoryId = dto.categoryId
      ? (await this.categories.resolveForEntry(scope, dto.categoryId, 'EXPENSE'))
          .id
      : undefined;

    const expenseDate = dto.expenseDate ? new Date(dto.expenseDate) : undefined;
    // Moving the date can move the accounting month, so the period follows it.
    const period = expenseDate
      ? await this.periods.ensurePeriodFor(scope, expenseDate)
      : undefined;

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const expense = await tx.expense.update({
          where: { id: existing.id },
          data: {
            ...(categoryId ? { categoryId } : {}),
            ...(dto.vendorName !== undefined
              ? { vendorName: dto.vendorName.trim() }
              : {}),
            ...(dto.description !== undefined
              ? { description: dto.description.trim() }
              : {}),
            ...(dto.invoiceReference !== undefined
              ? { invoiceReference: dto.invoiceReference?.trim() || null }
              : {}),
            ...(dto.amount !== undefined
              ? { amount: toDecimal(dto.amount) }
              : {}),
            ...(expenseDate ? { expenseDate } : {}),
            ...(period ? { financialPeriodId: period.id } : {}),
          },
          include: { category: { select: { name: true } } },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'finance.expense.updated',
          resourceType: 'Expense',
          resourceId: expense.id,
          before: {
            amount: toAmount(existing.amount),
            vendorName: existing.vendorName,
          },
          after: {
            amount: toAmount(expense.amount),
            vendorName: expense.vendorName,
          },
        });

        return expense;
      });

      return toExpenseResponse(updated);
    } catch (error) {
      if (isDuplicateReference(error)) {
        throw new ConflictException(ERRORS.duplicateExpenseReference);
      }
      throw error;
    }
  }

  /** DRAFT → SUBMITTED. Freezes the figures for review; still no ledger effect. */
  async submit(
    scope: RequestScope,
    expenseId: string,
  ): Promise<ExpenseResponse> {
    const existing = await this.load(scope, expenseId);
    this.assertStatus(existing, 'DRAFT', ERRORS.expenseNotDraft);

    return this.transition(scope, existing, {
      status: 'SUBMITTED',
      submittedAt: new Date(),
    }, 'finance.expense.submitted');
  }

  /**
   * SUBMITTED → APPROVED (§39). A decision, not a payment — nothing is posted.
   *
   * Refuses when the approver is the person who created the expense. This is the
   * check the permission matrix cannot make: an ORG_ADMIN holds both
   * EXPENSE_CREATE and EXPENSE_APPROVE for good operational reasons, and without
   * this guard that single account could enter and approve its own spending with
   * no second pair of eyes anywhere in the chain.
   */
  async approve(
    scope: RequestScope,
    expenseId: string,
  ): Promise<ExpenseResponse> {
    const existing = await this.load(scope, expenseId);
    this.assertStatus(existing, 'SUBMITTED', ERRORS.expenseNotSubmitted);

    if (
      existing.createdByPersonId &&
      scope.personId &&
      existing.createdByPersonId === scope.personId
    ) {
      throw new ForbiddenException(ERRORS.expenseSelfApprovalForbidden);
    }

    return this.transition(scope, existing, {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedByPersonId: scope.personId ?? null,
    }, 'finance.expense.approved');
  }

  /** SUBMITTED → REJECTED. The reason is mandatory and stored on the row. */
  async reject(
    scope: RequestScope,
    expenseId: string,
    dto: RejectExpenseDto,
  ): Promise<ExpenseResponse> {
    const existing = await this.load(scope, expenseId);
    this.assertStatus(existing, 'SUBMITTED', ERRORS.expenseNotSubmitted);

    if (!dto.reason?.trim()) {
      throw new ConflictException(ERRORS.expenseDecisionReasonRequired);
    }

    return this.transition(scope, existing, {
      status: 'REJECTED',
      approvedByPersonId: scope.personId ?? null,
      decisionReason: dto.reason.trim(),
    }, 'finance.expense.rejected');
  }

  /**
   * APPROVED → PAID. THE ONLY TRANSITION WITH A LEDGER EFFECT (§40).
   *
   * Posts a building-level DEBIT with `unitId: null`. See invariant 2 on the
   * class: this deliberately does not touch any resident's balance.
   *
   * The period is re-resolved rather than reused: an expense entered in Mordad
   * and paid in Shahrivar may find its original month already sealed (§10), and
   * the ledger would refuse the post. Resolving the open period at payment time
   * puts the money where it actually moved.
   *
   * The status guard and the ledger write share one transaction, so two
   * concurrent pay calls cannot both pass the check and post twice — the second
   * finds the row already PAID inside its own transaction.
   */
  async pay(
    scope: RequestScope,
    expenseId: string,
    dto: PayExpenseDto = {},
  ): Promise<ExpenseResponse> {
    const existing = await this.load(scope, expenseId);

    if (existing.status === 'PAID') {
      throw new ConflictException(ERRORS.expenseAlreadyPaid);
    }
    this.assertStatus(existing, 'APPROVED', ERRORS.expenseNotApproved);

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    const period = dto.financialPeriodId
      ? await this.periods.findOne(scope, dto.financialPeriodId)
      : await this.periods.ensurePeriodFor(scope, paidAt);

    const paid = await this.prisma.$transaction(async (tx) => {
      // SELECT ... FOR UPDATE, not a plain re-read, and the difference is the
      // whole guard. Under READ COMMITTED two concurrent pay calls both see
      // APPROVED, both pass an unlocked check and both post — the building is
      // debited twice for one supplier bill. The e2e suite caught exactly this:
      // four parallel calls produced two 201s and two ledger entries.
      //
      // The row lock serialises them: the loser blocks here, then reads PAID
      // and gets the Persian 409. Same lesson as credit application and the
      // ownership share totals.
      const locked = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status"
        FROM "expenses"
        WHERE "id" = ${existing.id}::uuid
          AND "buildingId" = ${scope.buildingId!}::uuid
        FOR UPDATE
      `;

      const current = locked[0];
      if (!current) throw new NotFoundException(ERRORS.expenseNotFound);
      if (current.status === 'PAID') {
        throw new ConflictException(ERRORS.expenseAlreadyPaid);
      }
      if (current.status !== 'APPROVED') {
        throw new ConflictException(ERRORS.expenseNotApproved);
      }

      const entry = await this.ledger.post(tx, scope, {
        // Building-level: the expense is what the BUILDING spent.
        unitId: null,
        financialPeriodId: period.id,
        direction: 'DEBIT',
        amount: existing.amount,
        referenceType: 'EXPENSE',
        referenceId: existing.id,
        description: `${existing.vendorName} — ${existing.description}`,
        occurredAt: paidAt,
        currency: existing.currency,
      });

      const expense = await tx.expense.update({
        where: { id: existing.id },
        data: {
          status: 'PAID',
          paidAt,
          financialPeriodId: period.id,
          ledgerEntryId: entry.id,
        },
        include: { category: { select: { name: true } } },
      });

      await this.audit.logInTransaction(tx, scope, {
        action: 'finance.expense.paid',
        resourceType: 'Expense',
        resourceId: expense.id,
        before: { status: existing.status },
        after: {
          status: expense.status,
          amount: toAmount(expense.amount),
          ledgerEntryId: entry.id,
          note: dto.note ?? null,
        },
      });

      return expense;
    });

    return toExpenseResponse(paid);
  }

  /**
   * Withdraws an expense before it is paid.
   *
   * CANCELLED is kept distinct from REJECTED on purpose: cancelled means the
   * requester withdrew it, rejected means an approver refused it. A building
   * arguing with a contractor needs to tell those apart, and collapsing both
   * into one status destroys the only record of who stopped the payment.
   *
   * A PAID expense cannot be cancelled — money has left the account, and §70
   * forbids deleting a transaction. The correction is a ledger reversal.
   */
  async cancel(
    scope: RequestScope,
    expenseId: string,
  ): Promise<ExpenseResponse> {
    const existing = await this.load(scope, expenseId);

    if (existing.status === 'PAID') {
      throw new ConflictException(ERRORS.expenseAlreadyPaid);
    }
    if (existing.status === 'REJECTED' || existing.status === 'CANCELLED') {
      throw new ConflictException(ERRORS.expenseFinalized);
    }

    return this.transition(scope, existing, {
      status: 'CANCELLED',
    }, 'finance.expense.cancelled');
  }

  /** Shared writer for the transitions that carry NO financial effect. */
  private async transition(
    scope: RequestScope,
    existing: Expense,
    data: Prisma.ExpenseUncheckedUpdateInput,
    action: string,
  ): Promise<ExpenseResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.update({
        where: { id: existing.id },
        data,
        include: { category: { select: { name: true } } },
      });

      await this.audit.logInTransaction(tx, scope, {
        action,
        resourceType: 'Expense',
        resourceId: expense.id,
        before: { status: existing.status },
        after: {
          status: expense.status,
          decisionReason: expense.decisionReason,
        },
      });

      return expense;
    });

    return toExpenseResponse(updated);
  }

  private assertStatus(
    expense: Expense,
    expected: Expense['status'],
    message: string,
  ): void {
    if (expense.status !== expected) {
      throw new ConflictException(message);
    }
  }

  private async load(scope: RequestScope, expenseId: string): Promise<Expense> {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, ...this.tenantWhere(scope) },
    });
    if (!expense) throw new NotFoundException(ERRORS.expenseNotFound);
    return expense;
  }
}

function toExpenseResponse(
  expense: Expense & { category?: { name: string } | null },
): ExpenseResponse {
  return {
    id: expense.id,
    categoryId: expense.categoryId,
    categoryName: expense.category?.name ?? null,
    financialPeriodId: expense.financialPeriodId,
    vendorName: expense.vendorName,
    description: expense.description,
    invoiceReference: expense.invoiceReference,
    amount: toAmount(expense.amount),
    currency: expense.currency,
    expenseDate: expense.expenseDate.toISOString(),
    status: expense.status,
    ledgerEntryId: expense.ledgerEntryId,
    createdByPersonId: expense.createdByPersonId,
    approvedByPersonId: expense.approvedByPersonId,
    decisionReason: expense.decisionReason,
    submittedAt: expense.submittedAt?.toISOString() ?? null,
    approvedAt: expense.approvedAt?.toISOString() ?? null,
    paidAt: expense.paidAt?.toISOString() ?? null,
    createdAt: expense.createdAt.toISOString(),
  };
}

/** True when a write collided with the vendor/invoice-reference unique. */
function isDuplicateReference(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
