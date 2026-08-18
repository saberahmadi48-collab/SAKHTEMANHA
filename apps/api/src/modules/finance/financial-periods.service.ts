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
import { jalaliMonthOf, jalaliMonthRange } from '../../core/finance/jalali-period';
import { LedgerService } from '../../core/finance/ledger.service';
import type {
  CloseFinancialPeriodDto,
  CreateFinancialPeriodDto,
  FinancialPeriodResponse,
  ReopenFinancialPeriodDto,
} from './dto/financial-period.dto';

/**
 * Financial periods — the accounting month and its lifecycle (BM-03 §9/§10/§59).
 *
 * WHY A PERIOD IS A ROW AND NOT A DATE FILTER: it has STATE. Closing is a
 * deliberate act by a named person at a recorded moment, and it is what makes
 * historical figures stop moving. A computed date range cannot be closed, so
 * every "why did last month's total change?" question would be unanswerable.
 *
 * THE ONE RULE THAT MATTERS HERE: a CLOSED period refuses financial writes. The
 * check lives in LedgerService.post (every financial effect funnels through it)
 * rather than being repeated in each caller — "we forgot to check on the refund
 * path" is exactly how a sealed month silently changes after sign-off.
 *
 * Reopening is deliberately awkward: it needs a reason, it is audited, and the
 * status becomes REOPENED rather than OPEN so the period stays visibly different
 * forever.
 */
@Injectable()
export class FinancialPeriodsService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {
    super();
  }

  /** Periods newest first — the period picker and the finance dashboard. */
  async list(
    scope: RequestScope,
    options: { year?: number } = {},
  ): Promise<FinancialPeriodResponse[]> {
    const rows = await this.prisma.financialPeriod.findMany({
      where: {
        ...this.tenantWhere(scope),
        ...(options.year ? { year: options.year } : {}),
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return Promise.all(rows.map((row) => this.toResponse(scope, row)));
  }

  async findOne(
    scope: RequestScope,
    periodId: string,
  ): Promise<FinancialPeriodResponse> {
    return this.toResponse(scope, await this.load(scope, periodId));
  }

  /**
   * The period a given instant falls in — normally "now".
   *
   * Charge generation and payment settlement both need "which period does this
   * belong to?", and both must get the SAME answer, so the lookup lives here
   * rather than being re-derived per caller.
   */
  async findCurrent(scope: RequestScope, asOf: Date = new Date()) {
    return this.prisma.financialPeriod.findFirst({
      where: {
        ...this.tenantWhere(scope),
        startsAt: { lte: asOf },
        endsAt: { gt: asOf },
      },
    });
  }

  /**
   * Opens a Jalali accounting month.
   *
   * The client sends year + month; the server derives the absolute interval
   * (§9). Boundaries are NEVER taken from the client in the normal path — two
   * clients disagreeing about when Mehr begins would file charges into different
   * months for the same building.
   */
  async create(
    scope: RequestScope,
    dto: CreateFinancialPeriodDto,
  ): Promise<FinancialPeriodResponse> {
    const building = await this.prisma.building.findFirst({
      where: { id: scope.buildingId!, archivedAt: null },
      select: { timeZone: true },
    });
    if (!building) throw new NotFoundException(ERRORS.buildingNotAccessible);

    const derived = jalaliMonthRange(
      dto.year,
      dto.month,
      building.timeZone ?? 'Asia/Tehran',
    );
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : derived.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : derived.endsAt;

    if (endsAt <= startsAt) {
      throw new ConflictException(ERRORS.periodEndBeforeStart);
    }

    try {
      const period = await this.prisma.$transaction(async (tx) => {
        const created = await tx.financialPeriod.create({
          data: {
            buildingId: scope.buildingId!,
            year: dto.year,
            month: dto.month,
            startsAt,
            endsAt,
            status: 'OPEN',
          },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'finance.period.opened',
          resourceType: 'FinancialPeriod',
          resourceId: created.id,
          after: { year: dto.year, month: dto.month },
        });

        return created;
      });

      return this.toResponse(scope, period);
    } catch (error) {
      throw translatePeriodConflict(error);
    }
  }

  /**
   * Seals a period (§59).
   *
   * Unsettled invoices do NOT block closing by default-refusal — an unpaid
   * charge is a normal month-end state, and a system that refused to close would
   * push managers to write off real debts just to proceed. Instead the caller
   * must acknowledge them explicitly, so the decision is conscious and audited.
   */
  async close(
    scope: RequestScope,
    periodId: string,
    dto: CloseFinancialPeriodDto,
  ): Promise<FinancialPeriodResponse> {
    const period = await this.load(scope, periodId);

    if (period.status === 'CLOSED') {
      throw new ConflictException(ERRORS.periodAlreadyClosed);
    }

    if (!dto.allowUnsettledInvoices) {
      const unsettled = await this.prisma.invoice.count({
        where: {
          ...this.tenantWhere(scope),
          financialPeriodId: periodId,
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
      });
      if (unsettled > 0) {
        throw new ConflictException(ERRORS.periodHasUnsettledInvoices);
      }
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.financialPeriod.update({
        where: { id: periodId },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedByPersonId: scope.personId ?? null,
        },
      });

      await this.audit.logInTransaction(tx, scope, {
        action: 'finance.period.closed',
        resourceType: 'FinancialPeriod',
        resourceId: periodId,
        before: { status: period.status },
        after: {
          status: 'CLOSED',
          note: dto.note ?? null,
          allowedUnsettled: Boolean(dto.allowUnsettledInvoices),
        },
      });

      return updated;
    });

    return this.toResponse(scope, closed);
  }

  /**
   * Reopens a sealed period (§10).
   *
   * Status becomes REOPENED, never OPEN. That distinction is the whole point: a
   * month that was sealed and later unsealed must stay visibly different from
   * one that was never closed, because an auditor has to be able to ask why.
   */
  async reopen(
    scope: RequestScope,
    periodId: string,
    dto: ReopenFinancialPeriodDto,
  ): Promise<FinancialPeriodResponse> {
    const period = await this.load(scope, periodId);

    if (period.status !== 'CLOSED') {
      throw new ConflictException(ERRORS.periodNotOpen);
    }
    if (!dto.reason?.trim()) {
      throw new ConflictException(ERRORS.periodReopenReasonRequired);
    }

    const reopened = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.financialPeriod.update({
        where: { id: periodId },
        data: {
          status: 'REOPENED',
          reopenedAt: new Date(),
          reopenReason: dto.reason,
        },
      });

      await this.audit.logInTransaction(tx, scope, {
        action: 'finance.period.reopened',
        resourceType: 'FinancialPeriod',
        resourceId: periodId,
        before: { status: 'CLOSED', closedAt: period.closedAt },
        after: { status: 'REOPENED', reason: dto.reason },
      });

      return updated;
    });

    return this.toResponse(scope, reopened);
  }

  /**
   * Finds the open period covering `asOf`, creating it if the building has not
   * opened it yet (§50 — "Month Starts -> Open Financial Period").
   *
   * Used by charge generation so a manager running the monthly process does not
   * have to remember a separate "open the month" step.
   */
  async ensurePeriodFor(scope: RequestScope, asOf: Date = new Date()) {
    const existing = await this.findCurrent(scope, asOf);
    if (existing) return existing;

    const building = await this.prisma.building.findFirst({
      where: { id: scope.buildingId! },
      select: { timeZone: true },
    });
    const timeZone = building?.timeZone ?? 'Asia/Tehran';
    const { year, month } = jalaliMonthOf(asOf, timeZone);

    await this.create(scope, { year, month });

    const created = await this.findCurrent(scope, asOf);
    if (!created) throw new NotFoundException(ERRORS.periodNotFound);
    return created;
  }

  private async load(scope: RequestScope, periodId: string) {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: periodId, ...this.tenantWhere(scope) },
    });
    if (!period) throw new NotFoundException(ERRORS.periodNotFound);
    return period;
  }

  /**
   * Maps a row to the API shape, including the period's headline totals.
   *
   * Totals come from the LEDGER, not from summing invoices: the ledger is the
   * source of truth (§7), and a figure derived from anywhere else can disagree
   * with the statement a resident sees.
   */
  private async toResponse(
    scope: RequestScope,
    period: {
      id: string;
      year: number;
      month: number;
      startsAt: Date;
      endsAt: Date;
      status: string;
      closedAt: Date | null;
      reopenedAt: Date | null;
      reopenReason: string | null;
    },
  ): Promise<FinancialPeriodResponse> {
    const totals = await this.ledger.buildingBalance(scope, {
      financialPeriodId: period.id,
    });

    return {
      id: period.id,
      year: period.year,
      month: period.month,
      startsAt: period.startsAt.toISOString(),
      endsAt: period.endsAt.toISOString(),
      status: period.status,
      closedAt: period.closedAt?.toISOString() ?? null,
      reopenedAt: period.reopenedAt?.toISOString() ?? null,
      reopenReason: period.reopenReason,
      totals: {
        // Debits are what was charged; credits are what came in.
        charged: totals.debit,
        collected: totals.credit,
        outstanding: totals.outstanding,
      },
    };
  }
}

/**
 * Translates the two DB rules that can reject a period into Persian 409s.
 *
 * BOTH must be handled, and this is the third time this exact lesson has come up
 * in this codebase (management terms, then ownership): under concurrency it is
 * not predictable which constraint fires first. The unique index on
 * (buildingId, year, month) raises P2002; the EXCLUDE range constraint raises
 * 23P01. Translating only one leaves the loser of a double-click with a raw 500.
 */
function translatePeriodConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new ConflictException(ERRORS.periodAlreadyExists);
    }
    // Postgres exclusion_violation surfaces as an unknown-code Prisma error.
    if (error.code === 'P2010' || error.message.includes('23P01')) {
      return new ConflictException(ERRORS.periodOverlapsExisting);
    }
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes('financial_periods_no_overlap')
  ) {
    return new ConflictException(ERRORS.periodOverlapsExisting);
  }
  return error;
}
