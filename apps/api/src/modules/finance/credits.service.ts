import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantScopedRepository } from '../../core/database/tenant-scoped.repository';
import { LedgerService } from '../../core/finance/ledger.service';
import { isPositive, sum, toAmount } from '../../core/finance/money';
import type {
  ApplyCreditDto,
  ApplyCreditResponse,
  ListCreditsQueryDto,
  StatementLineResponse,
  UnitCreditResponse,
  UnitStatementResponse,
} from './dto/payment.dto';

/**
 * Unit credit and the unit's financial position (BM-03 §26-§28).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * APPLYING CREDIT POSTS NOTHING TO THE LEDGER, AND THAT IS THE WHOLE DESIGN.
 *
 * This looks wrong at first glance — money moves onto an invoice, surely
 * something should be recorded? No. The money was credited to the unit ONCE,
 * when the payment arrived (`payments.service.ts` posts the FULL amount,
 * including the overpaid part). A credit is not new money; it is a label on
 * money the ledger already knows about, saying "this part has not been matched
 * to a document yet".
 *
 * Posting a second CREDIT on application would settle the same 500,000 twice and
 * leave the unit's balance 500,000 better off than the cash they actually paid.
 * The e2e suite asserts exactly this: applying credit changes the INVOICE but
 * leaves the unit's outstanding balance and the ledger row count untouched.
 *
 * The corollary, so the pairing is never broken from the other end: if anyone
 * ever changes `recordManual` to post only the settled portion, this file must
 * change in the same commit — otherwise overpaid money vanishes from the books
 * entirely.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class CreditsService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {
    super();
  }

  async list(
    scope: RequestScope,
    query: ListCreditsQueryDto = {},
  ): Promise<UnitCreditResponse[]> {
    const credits = await this.prisma.unitCredit.findMany({
      where: {
        ...this.tenantWhere(scope),
        ...(query.unitId ? { unitId: query.unitId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });

    return credits.map(toCreditResponse);
  }

  /**
   * Applies a unit's available credit to one outstanding invoice (§27).
   *
   * OLDEST CREDIT FIRST, and the ordering is not arbitrary: credit that has sat
   * longest is the most likely to be queried, disputed or expired, and a
   * deterministic order means re-running the same application twice produces the
   * same audit trail. Random or newest-first consumption makes "which payment
   * settled my Mehr invoice?" unanswerable.
   *
   * The caller names no amount — the service applies the smaller of what exists
   * and what is owed. See `ApplyCreditDto` for why: a client-supplied figure can
   * exceed either side and produce a balance no ledger entry justifies.
   */
  async apply(
    scope: RequestScope,
    dto: ApplyCreditDto,
  ): Promise<ApplyCreditResponse> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, ...this.tenantWhere(scope) },
    });
    if (!invoice) throw new NotFoundException(ERRORS.invoiceNotFound);

    if (invoice.status === 'CANCELLED') {
      throw new ConflictException(ERRORS.invoiceCancelled);
    }
    if (invoice.status === 'PAID' || !isPositive(invoice.balance)) {
      throw new ConflictException(ERRORS.invoiceAlreadyPaid);
    }
    if (invoice.status === 'DRAFT') {
      throw new ConflictException(ERRORS.invoiceNotIssued);
    }

    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE, not a plain read. Two concurrent applications against the
      // same credit would otherwise both see the full remaining amount and both
      // spend it — the identical race the ownership module hit on share totals.
      // A row lock is the only thing that makes "apply at most what exists"
      // true under a double-click.
      const credits = await tx.$queryRaw<
        { id: string; remainingAmount: Prisma.Decimal }[]
      >`
        SELECT "id", "remainingAmount"
        FROM "unit_credits"
        WHERE "buildingId" = ${scope.buildingId!}::uuid
          AND "unitId" = ${invoice.unitId}::uuid
          AND "status" IN ('AVAILABLE', 'PARTIALLY_APPLIED')
          AND "remainingAmount" > 0
        ORDER BY "createdAt" ASC
        FOR UPDATE
      `;

      if (credits.length === 0) {
        throw new ConflictException(ERRORS.creditInsufficient);
      }

      let outstanding = invoice.balance;
      let applied = new Prisma.Decimal(0);
      const creditsUsed: string[] = [];

      for (const credit of credits) {
        if (!isPositive(outstanding)) break;

        const remaining = new Prisma.Decimal(credit.remainingAmount);
        const take = remaining.lessThan(outstanding) ? remaining : outstanding;
        const left = remaining.minus(take);

        await tx.unitCredit.update({
          where: { id: credit.id },
          data: {
            remainingAmount: left,
            // APPLIED means fully consumed; PARTIALLY_APPLIED means some is
            // left. The distinction matters to §27's "may later be applied":
            // a partially used credit is still spendable and must keep showing.
            status: left.isZero() ? 'APPLIED' : 'PARTIALLY_APPLIED',
          },
        });

        applied = applied.plus(take);
        outstanding = outstanding.minus(take);
        creditsUsed.push(credit.id);
      }

      if (!isPositive(applied)) {
        throw new ConflictException(ERRORS.creditInsufficient);
      }

      const paidAmount = invoice.paidAmount.plus(applied);
      const balance = invoice.total.minus(paidAmount);

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount,
          balance,
          status: balance.lessThanOrEqualTo(0) ? 'PAID' : 'PARTIALLY_PAID',
          paidAt: balance.lessThanOrEqualTo(0) ? new Date() : null,
        },
      });

      // NO LEDGER POST HERE. See the class note — the money was credited when
      // the payment arrived, and crediting it again would pay it twice.
      await this.audit.logInTransaction(tx, scope, {
        action: 'finance.credit.applied',
        resourceType: 'Invoice',
        resourceId: invoice.id,
        before: {
          balance: toAmount(invoice.balance),
          status: invoice.status,
        },
        after: {
          appliedAmount: toAmount(applied),
          balance: toAmount(balance),
          status: updated.status,
          creditsUsed,
          note: dto.note ?? null,
        },
      });

      const remainingCredit = await this.availableCredit(
        scope,
        invoice.unitId,
        tx,
      );

      return {
        invoiceId: invoice.id,
        appliedAmount: toAmount(applied),
        invoiceBalance: toAmount(balance),
        invoiceStatus: updated.status,
        remainingCredit,
        creditsUsed,
      };
    });
  }

  /**
   * A unit's financial position and recent ledger activity (§28/§54).
   *
   * `outstanding` comes from `LedgerService.balanceFor` — SUM(debits) -
   * SUM(credits) over actual entries — rather than from any stored column, so it
   * is recomputable from scratch and cannot drift from the rows that justify it.
   *
   * `availableCredit` is reported SEPARATELY and is deliberately not netted off
   * `outstanding`. A unit owing 500,000 while holding 200,000 of unmatched
   * credit is a genuinely different situation from one owing 300,000 — the first
   * has money sitting on account waiting to be applied — and folding them
   * together destroys the distinction the manager needs to act on.
   */
  async statement(
    scope: RequestScope,
    unitId: string,
    options: { take?: number } = {},
  ): Promise<UnitStatementResponse> {
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, ...this.tenantWhere(scope) },
      select: { id: true },
    });
    if (!unit) throw new NotFoundException(ERRORS.unitNotInBuilding);

    const [balance, availableCredit, openInvoiceCount, entries] =
      await Promise.all([
        this.ledger.balanceFor(scope, unitId),
        this.availableCredit(scope, unitId),
        this.prisma.invoice.count({
          where: {
            ...this.tenantWhere(scope),
            unitId,
            status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
        }),
        this.ledger.list(scope, { unitId, take: options.take ?? 100 }),
      ]);

    return {
      unitId,
      debit: balance.debit,
      credit: balance.credit,
      outstanding: balance.outstanding,
      availableCredit,
      openInvoiceCount,
      lines: entries.map(toStatementLine),
    };
  }

  /**
   * Credit the unit holds that no invoice has consumed.
   *
   * Sums `remainingAmount` rather than `amount`: a partially applied credit has
   * only its unspent part available, and using `amount` would let the same money
   * be offered twice.
   */
  private async availableCredit(
    scope: RequestScope,
    unitId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;

    const credits = await client.unitCredit.findMany({
      where: {
        buildingId: scope.buildingId!,
        unitId,
        status: { in: ['AVAILABLE', 'PARTIALLY_APPLIED'] },
      },
      select: { remainingAmount: true },
    });

    return toAmount(sum(credits.map((credit) => credit.remainingAmount)));
  }
}

function toCreditResponse(credit: {
  id: string;
  unitId: string;
  amount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  currency: string;
  status: string;
  sourceReferenceType: string;
  sourceReferenceId: string | null;
  note: string | null;
  createdAt: Date;
}): UnitCreditResponse {
  return {
    id: credit.id,
    unitId: credit.unitId,
    amount: toAmount(credit.amount),
    remainingAmount: toAmount(credit.remainingAmount),
    currency: credit.currency,
    status: credit.status,
    sourceReferenceType: credit.sourceReferenceType,
    sourceReferenceId: credit.sourceReferenceId,
    note: credit.note,
    createdAt: credit.createdAt.toISOString(),
  };
}

function toStatementLine(entry: {
  id: string;
  occurredAt: Date;
  direction: string;
  amount: Prisma.Decimal;
  referenceType: string;
  referenceId: string | null;
  description: string | null;
}): StatementLineResponse {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    direction: entry.direction,
    amount: toAmount(entry.amount),
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    description: entry.description,
  };
}
