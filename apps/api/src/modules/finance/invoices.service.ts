import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type FinancialPeriod } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantScopedRepository } from '../../core/database/tenant-scoped.repository';
import { sum, toAmount } from '../../core/finance/money';
import { FinancialPeriodsService } from './financial-periods.service';
import type {
  CancelInvoiceDto,
  InvoiceResponse,
  IssueInvoicesDto,
  IssueInvoicesResponse,
  ListInvoicesQueryDto,
} from './dto/invoice.dto';

/** Charge statuses that may still be placed on an invoice. */
const BILLABLE_CHARGE_STATUSES = ['DRAFT', 'ISSUED'] as const;

/**
 * Invoicing — turning charges into payable documents (BM-03 §21-§25).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SINGLE MOST IMPORTANT FACT ABOUT THIS SERVICE: ISSUING AN INVOICE WRITES
 * NOTHING TO THE LEDGER.
 *
 * It is tempting to post a DEBIT here — an invoice is money owed, after all —
 * and it would double every resident's balance. The obligation was already
 * recorded when the CHARGE was generated (`charge-generation.service.ts` posts
 * DEBIT per charge). An invoice is the DOCUMENT that asks for money already
 * owed, not a second obligation: §70 states Charge ≠ Invoice ≠ Payment, and this
 * is where that separation is either honoured or silently broken.
 *
 * The e2e suite asserts exactly this: a unit's outstanding balance is IDENTICAL
 * before and after invoicing. If someone later adds a ledger post to `issue`,
 * that test is what catches it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ONE INVOICE PER UNIT PER RUN, bundling every uninvoiced charge for the period
 * (§22) — the spec's own example shows monthly charge, elevator repair, cleaning
 * and an extraordinary charge on ONE document, not four.
 *
 * A CHARGE IS BILLED AT MOST ONCE. The guarantee is structural, not a check:
 * `invoice_lines` carries `@@unique([chargeId])`, so a second line pointing at
 * the same charge is a database error rather than a resident receiving two
 * invoices for one obligation. The service also filters to charges with no line
 * yet, but that read races under a double-click and the constraint does not.
 */
@Injectable()
export class InvoicesService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly periods: FinancialPeriodsService,
  ) {
    super();
  }

  async list(
    scope: RequestScope,
    query: ListInvoicesQueryDto = {},
  ): Promise<InvoiceResponse[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        ...this.tenantWhere(scope),
        ...(query.status ? { status: query.status } : {}),
        ...(query.unitId ? { unitId: query.unitId } : {}),
        ...(query.financialPeriodId
          ? { financialPeriodId: query.financialPeriodId }
          : {}),
      },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ issueDate: 'desc' }, { invoiceNumber: 'desc' }],
      take: 200,
    });

    return invoices.map(toInvoiceResponse);
  }

  async findOne(scope: RequestScope, invoiceId: string): Promise<InvoiceResponse> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, ...this.tenantWhere(scope) },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!invoice) throw new NotFoundException(ERRORS.invoiceNotFound);

    return toInvoiceResponse(invoice);
  }

  /**
   * Issues invoices for every unit holding uninvoiced charges in the period
   * (§21/§50).
   *
   * ONE TRANSACTION FOR THE WHOLE BATCH, for the same reason generation uses
   * one: half an issued month — some units invoiced, others not, no error
   * raised — is worse than a failure, because nobody goes looking for it.
   */
  async issue(
    scope: RequestScope,
    dto: IssueInvoicesDto,
  ): Promise<IssueInvoicesResponse> {
    const period = dto.financialPeriodId
      ? await this.loadPeriod(scope, dto.financialPeriodId)
      : await this.periods.ensurePeriodFor(scope);

    // §10 — a sealed month does not gain new documents. Refused here, before a
    // single invoice number is burned: numbers are never reused (§23), so a
    // failure after allocation would leave a permanent gap in the sequence.
    if (period.status === 'CLOSED') {
      throw new ConflictException(ERRORS.periodClosed);
    }

    const issueDate = new Date();
    const dueDate = dto.dueDate
      ? new Date(dto.dueDate)
      : await this.deriveDueDate(scope, period);

    // Only the explicit override is validated against the issue date. A DERIVED
    // due date that has already passed is a real and correct state — generating
    // Mehr's charges during Aban produces an invoice that is genuinely overdue,
    // and §24 has an OVERDUE state precisely for it.
    if (dto.dueDate && dueDate < issueDate) {
      throw new ConflictException(ERRORS.invoiceDueBeforeIssue);
    }

    const charges = await this.loadBillableCharges(scope, period.id, dto.unitId);
    if (charges.length === 0) {
      throw new ConflictException(ERRORS.invoiceHasNoLines);
    }

    const byUnit = groupByUnit(charges);

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          const invoices: InvoiceWithLines[] = [];

          for (const [unitId, unitCharges] of byUnit) {
            const subtotal = sum(
              unitCharges.map((charge) => charge.calculatedAmount),
            );

            const invoiceNumber = await this.allocateInvoiceNumber(
              tx,
              scope.buildingId!,
              period,
            );

            const invoice = await tx.invoice.create({
              data: {
                buildingId: scope.buildingId!,
                unitId,
                financialPeriodId: period.id,
                invoiceNumber,
                issueDate,
                dueDate,
                subtotal,
                total: subtotal,
                // Nothing is paid at issue time, so the whole total is
                // outstanding. These two columns are a materialised convenience
                // for listing screens; the LEDGER remains the source of truth
                // (§7) and the e2e suite asserts the two agree.
                paidAmount: new Prisma.Decimal(0),
                balance: subtotal,
                status: 'ISSUED',
                issuedAt: issueDate,
                notes: dto.notes ?? null,
                lines: {
                  create: unitCharges.map((charge, index) => ({
                    buildingId: scope.buildingId!,
                    chargeId: charge.id,
                    // COPIED, never read through to the charge at display time:
                    // a document whose wording changes when master data is
                    // edited is not evidence of what was billed (§22).
                    description: charge.description ?? charge.chargeType,
                    quantity: new Prisma.Decimal(1),
                    unitPrice: charge.calculatedAmount,
                    amount: charge.calculatedAmount,
                    sortOrder: index,
                  })),
                },
              },
              include: { lines: { orderBy: { sortOrder: 'asc' } } },
            });

            // The charge is now on a document. INVOICED is what stops it being
            // picked up by the next issue run — belt to the unique constraint's
            // braces.
            await tx.charge.updateMany({
              where: {
                id: { in: unitCharges.map((charge) => charge.id) },
                buildingId: scope.buildingId!,
              },
              data: { status: 'INVOICED' },
            });

            invoices.push(invoice);
          }

          await this.audit.logInTransaction(tx, scope, {
            action: 'finance.invoices.issued',
            resourceType: 'FinancialPeriod',
            resourceId: period.id,
            after: {
              invoicesIssued: invoices.length,
              chargesBilled: charges.length,
              invoiceNumbers: invoices.map((invoice) => invoice.invoiceNumber),
              dueDate: dueDate.toISOString(),
            },
          });

          // Reported back on the run so "was this month invoiced?" is answerable
          // from the run row rather than by counting invoices.
          await tx.chargeRun.updateMany({
            where: {
              buildingId: scope.buildingId!,
              financialPeriodId: period.id,
            },
            data: { invoicesIssued: invoices.length },
          });

          return invoices;
        },
        { timeout: 30_000 },
      );

      const responses = created.map(toInvoiceResponse);

      return {
        financialPeriodId: period.id,
        invoicesIssued: responses.length,
        unitsSkipped: await this.countUnitsWithoutCharges(
          scope,
          period,
          byUnit.size,
          dto.unitId,
        ),
        totalAmount: responses.reduce(
          (total, invoice) => total + invoice.total,
          0,
        ),
        invoices: responses,
      };
    } catch (error) {
      throw translateInvoiceConflict(error);
    }
  }

  /**
   * Cancels an issued invoice and releases its charges to be billed again (§24).
   *
   * TWO THINGS THIS DELIBERATELY DOES NOT DO:
   *
   *  1. It does not delete the invoice. §24 is explicit that a paid invoice must
   *     not simply be deleted, and R2 applies to every row here: the document
   *     survives as CANCELLED, keeping its number so the sequence stays gap-free
   *     and auditable (§23).
   *
   *  2. It does not touch the ledger. Cancelling the DOCUMENT does not cancel
   *     the OBLIGATION — the resident still owes for the month, and the charge
   *     goes back to ISSUED so it can appear on a corrected invoice. Writing a
   *     credit here would forgive a debt nobody decided to forgive.
   *
   * Cancellation is refused once any payment has landed, because a settled
   * invoice must be undone with a reversal that leaves both sides visible (§46),
   * not by rewriting the document the payment was made against.
   *
   * The invoice lines keep their description and amount but LOSE their charge
   * link. That is what lets the charge be re-billed at all: `@@unique([chargeId])`
   * would otherwise make the cancelled line a permanent claim on it. The
   * cancelled document still reads correctly — it just no longer asserts that it
   * bills those specific charge rows.
   */
  async cancel(
    scope: RequestScope,
    invoiceId: string,
    dto: CancelInvoiceDto,
  ): Promise<InvoiceResponse> {
    if (!dto.reason?.trim()) {
      throw new ConflictException(ERRORS.reversalReasonRequired);
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, ...this.tenantWhere(scope) },
      include: { lines: true },
    });
    if (!invoice) throw new NotFoundException(ERRORS.invoiceNotFound);

    if (invoice.status === 'CANCELLED') {
      throw new ConflictException(ERRORS.invoiceCancelled);
    }
    if (invoice.paidAmount.greaterThan(0)) {
      throw new ConflictException(ERRORS.invoiceNotCancellable);
    }
    if (invoice.status === 'PAID') {
      throw new ConflictException(ERRORS.invoiceAlreadyPaid);
    }

    const chargeIds = invoice.lines
      .map((line) => line.chargeId)
      .filter((id): id is string => id !== null);

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          balance: new Prisma.Decimal(0),
          notes: dto.reason,
        },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });

      // Sever the link, keep the text. See the note above: this is what releases
      // the charge from the `@@unique([chargeId])` claim.
      await tx.invoiceLine.updateMany({
        where: { invoiceId, buildingId: scope.buildingId! },
        data: { chargeId: null },
      });

      if (chargeIds.length > 0) {
        await tx.charge.updateMany({
          where: { id: { in: chargeIds }, buildingId: scope.buildingId! },
          data: { status: 'ISSUED' },
        });
      }

      await this.audit.logInTransaction(tx, scope, {
        action: 'finance.invoice.cancelled',
        resourceType: 'Invoice',
        resourceId: invoiceId,
        before: {
          status: invoice.status,
          total: toAmount(invoice.total),
          invoiceNumber: invoice.invoiceNumber,
        },
        after: { status: 'CANCELLED', reason: dto.reason, chargesReleased: chargeIds },
      });

      return updated;
    });

    return toInvoiceResponse(cancelled);
  }

  /**
   * Allocates the next invoice number inside the caller's transaction (§23).
   *
   * Delegates to the `next_invoice_number` SQL function (prisma/sql/003), whose
   * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` takes a row lock and
   * serialises two managers issuing in the same second. The tempting
   * alternative, `COUNT(*) + 1`, is wrong twice over: it reuses a number after
   * any rollback, and it races under exactly the load it needs to survive.
   *
   * Formatting (`1404-07-000101`) happens here rather than in SQL so the stored
   * counter stays a plain integer the sequence table can reason about.
   *
   * EVERY PARAMETER IS CAST EXPLICITLY, and the year/month casts are not
   * cosmetic: Prisma binds a JavaScript number as `bigint`, so an uncast call
   * looks for `next_invoice_number(uuid, bigint, bigint)`, which does not exist,
   * and Postgres answers 42883 — surfacing as a raw 500 on every issue. Caught
   * by the e2e suite on its first run.
   */
  private async allocateInvoiceNumber(
    tx: Prisma.TransactionClient,
    buildingId: string,
    period: { year: number; month: number },
  ): Promise<string> {
    const rows = await tx.$queryRaw<{ next_invoice_number: number }[]>`
      SELECT next_invoice_number(
        ${buildingId}::uuid,
        ${period.year}::integer,
        ${period.month}::integer
      )
    `;

    const next = rows[0]?.next_invoice_number;
    if (next === undefined || next === null) {
      // Never invent a number: a duplicate or guessed invoice number is worse
      // than a failed issue, because §23 promises it is never reused.
      throw new ConflictException(ERRORS.invoiceNotFound);
    }

    const month = String(period.month).padStart(2, '0');
    const sequence = String(next).padStart(6, '0');
    return `${period.year}-${month}-${sequence}`;
  }

  /**
   * Charges that may still be billed: not yet on any invoice line, and in a
   * status that represents a live obligation.
   *
   * `invoiceLines: { none: {} }` is the load-bearing filter — CANCELLED and
   * REVERSED charges are excluded by status, and anything already billed is
   * excluded by the absence of a line. Under a double-click this read can still
   * return the same charge twice to two callers; that is what the unique
   * constraint on `invoice_lines.chargeId` is for.
   */
  private async loadBillableCharges(
    scope: RequestScope,
    financialPeriodId: string,
    unitId?: string,
  ) {
    return this.prisma.charge.findMany({
      where: {
        ...this.tenantWhere(scope),
        financialPeriodId,
        ...(unitId ? { unitId } : {}),
        status: { in: [...BILLABLE_CHARGE_STATUSES] },
        invoiceLines: { none: {} },
      },
      select: {
        id: true,
        unitId: true,
        description: true,
        chargeType: true,
        calculatedAmount: true,
      },
      orderBy: [{ unitId: 'asc' }, { generatedAt: 'asc' }],
    });
  }

  /**
   * The deadline for a period, from `BuildingSettings.chargeDueDay` (§14).
   *
   * Derived as an offset from the period's own start rather than by building a
   * calendar date, so it lands inside the Jalali month the charges belong to
   * without re-deriving the month boundary that `jalaliMonthRange` already
   * settled. Clamped to the last instant of the period: a `chargeDueDay` of 31
   * in a 30-day month must not push the deadline into the next month.
   */
  private async deriveDueDate(
    scope: RequestScope,
    period: { startsAt: Date; endsAt: Date },
  ): Promise<Date> {
    const settings = await this.prisma.buildingSettings.findFirst({
      where: { buildingId: scope.buildingId! },
      select: { chargeDueDay: true },
    });

    const dueDay = settings?.chargeDueDay ?? 10;
    const candidate = new Date(
      period.startsAt.getTime() + (dueDay - 1) * 24 * 60 * 60 * 1000,
    );

    return candidate < period.endsAt
      ? candidate
      : new Date(period.endsAt.getTime() - 1000);
  }

  /**
   * Units that hold no billable charge for this period.
   *
   * Reported so an issue that produced 12 invoices in a 40-unit building is
   * visibly partial. A run that silently skipped units looks identical to a
   * correct one if only the success count is published.
   */
  private async countUnitsWithoutCharges(
    scope: RequestScope,
    period: FinancialPeriod,
    unitsInvoiced: number,
    unitFilter?: string,
  ): Promise<number> {
    if (unitFilter) return 0;

    const activeUnits = await this.prisma.unit.count({
      where: { ...this.tenantWhere(scope), archivedAt: null, status: 'ACTIVE' },
    });

    return Math.max(0, activeUnits - unitsInvoiced);
  }

  private async loadPeriod(
    scope: RequestScope,
    periodId: string,
  ): Promise<FinancialPeriod> {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: periodId, ...this.tenantWhere(scope) },
    });
    if (!period) throw new NotFoundException(ERRORS.periodNotFound);
    return period;
  }
}

type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: { lines: true } }>;

type BillableCharge = {
  id: string;
  unitId: string;
  description: string | null;
  chargeType: string;
  calculatedAmount: Prisma.Decimal;
};

/** Groups charges into one bucket per unit, preserving query order (§22). */
function groupByUnit(
  charges: readonly BillableCharge[],
): Map<string, BillableCharge[]> {
  const byUnit = new Map<string, BillableCharge[]>();

  for (const charge of charges) {
    const bucket = byUnit.get(charge.unitId);
    if (bucket) bucket.push(charge);
    else byUnit.set(charge.unitId, [charge]);
  }

  return byUnit;
}

function toInvoiceResponse(invoice: InvoiceWithLines): InvoiceResponse {
  return {
    id: invoice.id,
    unitId: invoice.unitId,
    financialPeriodId: invoice.financialPeriodId,
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate.toISOString(),
    subtotal: toAmount(invoice.subtotal),
    discount: toAmount(invoice.discount),
    penalty: toAmount(invoice.penalty),
    total: toAmount(invoice.total),
    paidAmount: toAmount(invoice.paidAmount),
    balance: toAmount(invoice.balance),
    status: invoice.status,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    cancelledAt: invoice.cancelledAt?.toISOString() ?? null,
    notes: invoice.notes,
    lines: [...invoice.lines]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) => ({
        id: line.id,
        chargeId: line.chargeId,
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: toAmount(line.unitPrice),
        amount: toAmount(line.amount),
        sortOrder: line.sortOrder,
      })),
  };
}

/**
 * Translates the constraints that can reject an issue into Persian 409s.
 *
 * Two can fire, and which one wins under concurrency is not predictable — the
 * lesson this codebase has now learned in management terms, ownership, periods
 * and charge generation. `invoice_lines.chargeId` unique means the charge was
 * billed by a run that beat us; `invoices(buildingId, invoiceNumber)` unique
 * means two allocations collided. Leaving either untranslated hands the loser of
 * a double-click a raw 500.
 */
function translateInvoiceConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');

      return fields.includes('invoiceNumber')
        ? new ConflictException(ERRORS.invoiceAlreadyIssued)
        : new ConflictException(ERRORS.chargeAlreadyInvoiced);
    }
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes('invoice_lines')
  ) {
    return new ConflictException(ERRORS.chargeAlreadyInvoiced);
  }
  return error;
}
