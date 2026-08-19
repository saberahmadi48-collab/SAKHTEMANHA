import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type FinancialPeriod, type Invoice } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantScopedRepository } from '../../core/database/tenant-scoped.repository';
import { LedgerService } from '../../core/finance/ledger.service';
import { isPositive, toAmount, toDecimal } from '../../core/finance/money';
import { FinancialPeriodsService } from './financial-periods.service';
import type {
  ListPaymentsQueryDto,
  PaymentResponse,
  RecordManualPaymentDto,
  ReversePaymentDto,
} from './dto/payment.dto';

/** Invoice states that can still absorb money. */
const SETTLEABLE_INVOICE_STATUSES = [
  'ISSUED',
  'PARTIALLY_PAID',
  'OVERDUE',
] as const;

/**
 * Payments and settlement — money arriving and being applied (BM-03 §25-§29,
 * §33-§36).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE FACTS THAT GOVERN THIS FILE:
 *
 * 1. THE FULL AMOUNT IS ALWAYS CREDITED TO THE LEDGER — including the part no
 *    invoice consumed. A resident who pays 5,500,000 against a 5,000,000 invoice
 *    has handed over 5,500,000, and their outstanding balance must fall by that
 *    much. The 500,000 becomes a UnitCredit (§26) so it is *traceable*, but the
 *    credit row is a RECORD OF WHERE THE MONEY SITS, not a second financial
 *    effect. Posting only the settled part would quietly keep the overpayment
 *    off the books — money received that the ledger denies exists.
 *
 *    The consequence, stated so nobody "fixes" it later: applying that credit to
 *    a future invoice posts NOTHING to the ledger (see `applyCredit`). The money
 *    was credited once, when it arrived. Crediting again on application would
 *    pay the same 500,000 twice.
 *
 * 2. THE INVOICE COLUMNS ARE A CACHE; THE LEDGER IS THE TRUTH (§7). `paidAmount`
 *    and `balance` on `invoices` exist so a listing screen need not aggregate
 *    entries per row. They are updated in the same transaction as the ledger
 *    post, and the e2e suite asserts the two agree — if they ever diverge, the
 *    ledger is right and the columns are the bug.
 *
 * 3. A PAYMENT ROW IS NOT A LEDGER EFFECT (§70). The row records the event; the
 *    entry records the effect. `ledgerEntryId` is null until settlement actually
 *    happened, which is what makes "callback ≠ verified payment" (§33) a
 *    structural property rather than a comment.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHAT IS DELIBERATELY ABSENT: any gateway. §31 requires providers to arrive
 * through an abstraction and §69 lists provider integration as BM-04's job. This
 * service implements only §36's controlled manual fallback — which is why
 * `recordManual` demands a reference and an elevated permission, and why the
 * anti-duplicate guarantee is a database constraint rather than a check.
 */
@Injectable()
export class PaymentsService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly periods: FinancialPeriodsService,
  ) {
    super();
  }

  async list(
    scope: RequestScope,
    query: ListPaymentsQueryDto = {},
  ): Promise<PaymentResponse[]> {
    const payments = await this.prisma.payment.findMany({
      where: {
        ...this.tenantWhere(scope),
        ...(query.status ? { status: query.status } : {}),
        ...(query.unitId ? { unitId: query.unitId } : {}),
        ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
        ...(query.financialPeriodId
          ? { financialPeriodId: query.financialPeriodId }
          : {}),
      },
      include: { invoice: { select: { status: true, balance: true } } },
      orderBy: [{ requestedAt: 'desc' }],
      take: 200,
    });

    return payments.map(toPaymentResponse);
  }

  async findOne(scope: RequestScope, paymentId: string): Promise<PaymentResponse> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, ...this.tenantWhere(scope) },
      include: { invoice: { select: { status: true, balance: true } } },
    });
    if (!payment) throw new NotFoundException(ERRORS.paymentNotFound);

    return toPaymentResponse(payment);
  }

  /**
   * Records money received outside a gateway and settles it (§36).
   *
   * Manual entry is verified BY THE ACT OF RECORDING IT: a human with
   * PAYMENT_RECORD is asserting the cash or transfer arrived, so the payment is
   * created already SUCCEEDED and settles immediately. That is the honest model
   * for §36 — there is no external oracle to ask, which is precisely why the
   * permission is elevated, the reference mandatory and the creator audited. A
   * gateway payment (BM-04) will take the opposite path: created PENDING and
   * moved to SUCCEEDED only by server-side verification (§33).
   *
   * EVERYTHING HAPPENS IN ONE TRANSACTION. A payment row without its ledger
   * entry is a reconciliation exception someone has to chase by hand (§61), and
   * a settled invoice whose credit never posted is worse — the resident sees
   * PAID while still owing on the books.
   */
  async recordManual(
    scope: RequestScope,
    dto: RecordManualPaymentDto,
  ): Promise<PaymentResponse> {
    // §36 — a manual payment with no reference could be entered ten times and
    // the database would have no way to tell. Checked here so the caller gets
    // the specific Persian message rather than a validation blob.
    if (!dto.reference?.trim()) {
      throw new ConflictException(ERRORS.manualPaymentReferenceRequired);
    }

    const amount = toDecimal(dto.amount);
    if (!isPositive(amount)) {
      throw new ConflictException(ERRORS.amountMustBePositive);
    }

    const period = dto.financialPeriodId
      ? await this.loadPeriod(scope, dto.financialPeriodId)
      : await this.periods.ensurePeriodFor(scope);

    // §10 — money cannot land in a sealed month. Refused before anything is
    // written; the manager reopens the period or records it in the current one.
    if (period.status === 'CLOSED') {
      throw new ConflictException(ERRORS.periodClosed);
    }

    await this.assertUnitBelongs(scope, dto.unitId);

    const invoice = dto.invoiceId
      ? await this.loadSettleableInvoice(scope, dto.invoiceId, dto.unitId)
      : null;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // How much of this payment the invoice can absorb. Anything beyond it is
        // overpayment and becomes credit (§26) — never silently dropped, and
        // never forced onto the invoice as a negative balance.
        const settled = invoice
          ? minOf(amount, invoice.balance)
          : new Prisma.Decimal(0);
        const overpaid = amount.minus(settled);

        const payment = await tx.payment.create({
          data: {
            buildingId: scope.buildingId!,
            unitId: dto.unitId,
            invoiceId: invoice?.id ?? null,
            financialPeriodId: period.id,
            provider: 'MANUAL',
            providerTransactionId: dto.reference.trim(),
            method: dto.method,
            amount,
            settledAmount: settled,
            status: 'SUCCEEDED',
            recordedByPersonId: scope.personId ?? null,
            note: dto.note ?? null,
            verifiedAt: new Date(),
          },
        });

        // THE WHOLE AMOUNT, not just the settled part — see fact 1 in the class
        // note. The unit handed over this much and their balance must fall by
        // this much, whether or not a document consumed it.
        const entry = await this.ledger.post(tx, scope, {
          unitId: dto.unitId,
          financialPeriodId: period.id,
          direction: 'CREDIT',
          amount,
          referenceType: 'PAYMENT',
          referenceId: payment.id,
          description: invoice
            ? `پرداخت صورت‌حساب ${invoice.invoiceNumber}`
            : 'پرداخت علی‌الحساب',
          // §34/§35 — the same reference must never produce two financial
          // effects. Belt to the unique constraint's braces: this key is what
          // stops a retried gateway callback in BM-04 too.
          idempotencyKey: `payment:MANUAL:${dto.reference.trim()}`,
        });

        await tx.payment.update({
          where: { id: payment.id },
          data: { ledgerEntryId: entry.id },
        });

        let updatedInvoice: Invoice | null = null;
        if (invoice) {
          const paidAmount = invoice.paidAmount.plus(settled);
          const balance = invoice.total.minus(paidAmount);

          updatedInvoice = await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              paidAmount,
              balance,
              // §25 — the two-state progression the spec spells out. `balance`
              // is compared to zero rather than `paidAmount` to `total` so a
              // rounding difference can never leave an invoice one Rial short of
              // PAID forever.
              status: balance.lessThanOrEqualTo(0) ? 'PAID' : 'PARTIALLY_PAID',
              paidAt: balance.lessThanOrEqualTo(0) ? new Date() : null,
            },
          });
        }

        if (isPositive(overpaid)) {
          // §26/§27 — the excess must become a credit rather than disappearing.
          // No ledger post here: the money was already credited above, in full.
          await tx.unitCredit.create({
            data: {
              buildingId: scope.buildingId!,
              unitId: dto.unitId,
              amount: overpaid,
              remainingAmount: overpaid,
              status: 'AVAILABLE',
              sourceReferenceType: 'PAYMENT',
              sourceReferenceId: payment.id,
              note: invoice
                ? `مازاد پرداخت صورت‌حساب ${invoice.invoiceNumber}`
                : 'پرداخت علی‌الحساب',
            },
          });
        }

        await this.audit.logInTransaction(tx, scope, {
          action: 'finance.payment.recorded',
          resourceType: 'Payment',
          resourceId: payment.id,
          after: {
            unitId: dto.unitId,
            invoiceId: invoice?.id ?? null,
            amount: toAmount(amount),
            settledAmount: toAmount(settled),
            creditedAmount: toAmount(overpaid),
            method: dto.method,
            reference: dto.reference.trim(),
            ledgerEntryId: entry.id,
          },
        });

        return { payment, entry, invoice: updatedInvoice };
      });

      return toPaymentResponse({
        ...result.payment,
        ledgerEntryId: result.entry.id,
        invoice: result.invoice
          ? { status: result.invoice.status, balance: result.invoice.balance }
          : null,
      });
    } catch (error) {
      throw translatePaymentConflict(error);
    }
  }

  /**
   * Reverses a settled payment — a bounced cheque, a mis-keyed receipt (§46).
   *
   * THREE THINGS THIS DELIBERATELY DOES NOT DO:
   *
   *  1. It does not delete the payment. §70: Deleted Transaction ≠ Correction.
   *     The row survives as REVERSED beside its opposing entry, so the history
   *     shows both the money and its undoing.
   *
   *  2. It does not edit the original ledger entry — it cannot; the
   *     `ledger_entries_no_update` trigger rejects UPDATE outright. `reverse`
   *     writes a new DEBIT of the same size.
   *
   *  3. It does not touch credits already spent. If the overpayment was applied
   *     to another invoice before the reversal, clawing it back would rewrite a
   *     second document's settled history. Unconsumed credit from this payment
   *     IS withdrawn, because that money never went anywhere.
   */
  async reverse(
    scope: RequestScope,
    paymentId: string,
    dto: ReversePaymentDto,
  ): Promise<PaymentResponse> {
    if (!dto.reason?.trim()) {
      throw new ConflictException(ERRORS.reversalReasonRequired);
    }

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, ...this.tenantWhere(scope) },
      include: { invoice: true },
    });
    if (!payment) throw new NotFoundException(ERRORS.paymentNotFound);

    if (payment.status === 'REVERSED') {
      throw new ConflictException(ERRORS.ledgerEntryAlreadyReversed);
    }
    // Only a payment that actually settled has anything to undo. Reversing a
    // CREATED/PENDING row would write a DEBIT against money never credited —
    // inventing a debt out of a failed attempt.
    if (payment.status !== 'SUCCEEDED' || !payment.ledgerEntryId) {
      throw new ConflictException(ERRORS.paymentNotVerified);
    }

    const period = await this.periods.ensurePeriodFor(scope);

    const result = await this.prisma.$transaction(async (tx) => {
      // Into the CURRENTLY OPEN period, not the payment's original one: §10
      // forbids moving a sealed month's figures, so a correction lands where
      // corrections are allowed to land.
      await this.ledger.reverse(tx, scope, payment.ledgerEntryId!, {
        financialPeriodId: period.id,
        reason: dto.reason,
      });

      const reversed = await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'REVERSED', note: dto.reason },
      });

      // Roll the invoice back by exactly what this payment settled. Recomputed
      // from the stored `settledAmount` rather than by re-aggregating payments,
      // so a second reversal on the same invoice stays correct.
      let updatedInvoice: Invoice | null = null;
      if (payment.invoice && isPositive(payment.settledAmount)) {
        const paidAmount = maxOf(
          payment.invoice.paidAmount.minus(payment.settledAmount),
          new Prisma.Decimal(0),
        );
        const balance = payment.invoice.total.minus(paidAmount);

        updatedInvoice = await tx.invoice.update({
          where: { id: payment.invoice.id },
          data: {
            paidAmount,
            balance,
            status: balance.lessThanOrEqualTo(0)
              ? 'PAID'
              : isPositive(paidAmount)
                ? 'PARTIALLY_PAID'
                : 'ISSUED',
            paidAt: balance.lessThanOrEqualTo(0) ? payment.invoice.paidAt : null,
          },
        });
      }

      // Withdraw only credit this payment produced that nobody has spent. A
      // partially consumed credit is left at its remaining value: the consumed
      // part is already recorded against another invoice.
      await tx.unitCredit.updateMany({
        where: {
          buildingId: scope.buildingId!,
          sourceReferenceId: payment.id,
          status: 'AVAILABLE',
        },
        data: { status: 'EXPIRED', remainingAmount: new Prisma.Decimal(0) },
      });

      await this.audit.logInTransaction(tx, scope, {
        action: 'finance.payment.reversed',
        resourceType: 'Payment',
        resourceId: payment.id,
        before: {
          status: payment.status,
          amount: toAmount(payment.amount),
          settledAmount: toAmount(payment.settledAmount),
        },
        after: { status: 'REVERSED', reason: dto.reason },
      });

      return { payment: reversed, invoice: updatedInvoice };
    });

    return toPaymentResponse({
      ...result.payment,
      invoice: result.invoice
        ? { status: result.invoice.status, balance: result.invoice.balance }
        : null,
    });
  }

  /**
   * Loads an invoice that can still absorb money, refusing the states that
   * cannot with a specific reason each.
   *
   * The unit check matters: without it, a manager could settle building A's
   * invoice with building B's unit id and the money would land against the wrong
   * account with every individual row looking valid.
   */
  private async loadSettleableInvoice(
    scope: RequestScope,
    invoiceId: string,
    unitId: string,
  ): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, ...this.tenantWhere(scope) },
    });
    if (!invoice) throw new NotFoundException(ERRORS.invoiceNotFound);

    if (invoice.unitId !== unitId) {
      throw new ConflictException(ERRORS.invoiceNotFound);
    }
    if (invoice.status === 'CANCELLED') {
      throw new ConflictException(ERRORS.invoiceCancelled);
    }
    if (invoice.status === 'DRAFT') {
      throw new ConflictException(ERRORS.invoiceNotIssued);
    }
    if (invoice.status === 'PAID') {
      throw new ConflictException(ERRORS.invoiceAlreadyPaid);
    }
    if (!SETTLEABLE_INVOICE_STATUSES.includes(invoice.status as never)) {
      throw new ConflictException(ERRORS.invoiceNotIssued);
    }

    return invoice;
  }

  /** §64 — a unit from another building is not addressable from this scope. */
  private async assertUnitBelongs(
    scope: RequestScope,
    unitId: string,
  ): Promise<void> {
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, ...this.tenantWhere(scope) },
      select: { id: true },
    });
    if (!unit) throw new NotFoundException(ERRORS.unitNotInBuilding);
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

type PaymentRow = Prisma.PaymentGetPayload<object> & {
  invoice?: { status: string; balance: Prisma.Decimal } | null;
};

function minOf(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.lessThan(b) ? a : b;
}

function maxOf(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.greaterThan(b) ? a : b;
}

function toPaymentResponse(payment: PaymentRow): PaymentResponse {
  return {
    id: payment.id,
    unitId: payment.unitId,
    invoiceId: payment.invoiceId,
    financialPeriodId: payment.financialPeriodId,
    provider: payment.provider,
    providerTransactionId: payment.providerTransactionId,
    method: payment.method,
    amount: toAmount(payment.amount),
    settledAmount: toAmount(payment.settledAmount),
    // Surfaced rather than left for the client to subtract: overpayment is the
    // case a resident asks about, and a UI that has to compute it will get it
    // wrong somewhere.
    creditedAmount: toAmount(payment.amount.minus(payment.settledAmount)),
    currency: payment.currency,
    status: payment.status,
    ledgerEntryId: payment.ledgerEntryId,
    note: payment.note,
    requestedAt: payment.requestedAt.toISOString(),
    verifiedAt: payment.verifiedAt?.toISOString() ?? null,
    invoiceStatus: payment.invoice?.status ?? null,
    invoiceBalance: payment.invoice ? toAmount(payment.invoice.balance) : null,
  };
}

/**
 * Translates the constraints that can reject a payment into Persian 409s.
 *
 * Two can fire and which one wins is not predictable — the lesson this codebase
 * has now learned in ownership, periods, generation and invoicing.
 * `(provider, providerTransactionId)` unique means the same receipt was recorded
 * twice (§35); the ledger's `(buildingId, idempotencyKey)` unique means the same
 * financial effect was replayed (§34). Both mean "already settled, nothing
 * written twice" — and leaving either untranslated hands the loser of a
 * double-click a raw 500.
 */
function translatePaymentConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');

    if (fields.includes('providerTransactionId') || fields.includes('idempotencyKey')) {
      return new ConflictException(ERRORS.duplicateProviderTransaction);
    }
    return new ConflictException(ERRORS.duplicateProviderTransaction);
  }
  return error;
}
