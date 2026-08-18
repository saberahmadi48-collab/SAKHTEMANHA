import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  type LedgerDirection,
  type LedgerReferenceType,
} from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { isPositive, sum, toAmount, toDecimal } from './money';

/**
 * The ledger — the single source of financial truth (BM-03 §7/§8/§28).
 *
 * THIS IS THE ONLY PLACE IN THE CODEBASE ALLOWED TO WRITE `ledger_entries`.
 * Everything else (charges, invoices, payments, adjustments) calls `post` and
 * gets an entry back. Concentrating it here is what makes the invariants below
 * true of the WHOLE system rather than of one well-behaved caller:
 *
 *  1. APPEND-ONLY. There is no update or delete method, and there never should
 *     be. A mistake is corrected with `reverse`, which writes a NEW opposing
 *     entry (§46). The database enforces this too — the
 *     `ledger_entries_no_update` trigger rejects UPDATE and DELETE outright —
 *     so this is a structural guarantee, not a convention someone can forget.
 *
 *  2. BALANCE IS DERIVED, NEVER STORED. `balanceFor` aggregates debits minus
 *     credits at query time. No `balance += amount` exists anywhere (§8), which
 *     is why two concurrent payments cannot lose an update: they append two rows
 *     instead of racing on one column.
 *
 *  3. SIGN CONVENTION, stated once. DEBIT increases what the unit OWES (a
 *     charge). CREDIT decreases it (a payment). Outstanding = debits - credits.
 *     A positive balance means the unit owes money.
 *
 *  4. POSTING INTO A CLOSED PERIOD IS REFUSED (§10). Corrections go into an open
 *     period; sealed months do not move retroactively.
 *
 *  5. EXTERNALLY TRIGGERED EFFECTS CARRY AN IDEMPOTENCY KEY (§34). A payment
 *     provider that retries its callback finds the key taken and produces no
 *     second financial effect. The uniqueness is a DB constraint, not a
 *     read-then-write check, because the latter races under exactly the retry
 *     storm it is meant to survive.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Appends one entry. Call inside the caller's transaction so the financial
   * effect and the thing that caused it commit together — a payment row without
   * its ledger entry is a reconciliation exception someone has to chase (§61).
   *
   * Returns the created entry. Throws 409 on a replayed idempotency key, which
   * is the CORRECT answer for a duplicate callback: nothing was written twice.
   */
  async post(
    tx: Prisma.TransactionClient,
    scope: RequestScope,
    input: {
      unitId?: string | null;
      financialPeriodId: string;
      direction: LedgerDirection;
      amount: Prisma.Decimal | string | number;
      referenceType: LedgerReferenceType;
      referenceId?: string | null;
      description?: string | null;
      idempotencyKey?: string | null;
      occurredAt?: Date;
      currency?: string;
    },
  ) {
    const amount = toDecimal(input.amount);
    if (!isPositive(amount)) {
      // Direction carries the sign; a signed amount would let the same effect be
      // expressed two ways and make every aggregate ambiguous.
      throw new ConflictException(ERRORS.amountMustBePositive);
    }

    await this.assertPeriodAcceptsPostings(tx, scope, input.financialPeriodId);

    try {
      return await tx.ledgerEntry.create({
        data: {
          buildingId: scope.buildingId!,
          unitId: input.unitId ?? null,
          financialPeriodId: input.financialPeriodId,
          direction: input.direction,
          amount,
          currency: input.currency ?? 'IRR',
          referenceType: input.referenceType,
          referenceId: input.referenceId ?? null,
          description: input.description ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          occurredAt: input.occurredAt ?? new Date(),
          createdByPersonId: scope.personId ?? null,
        },
      });
    } catch (error) {
      if (isIdempotencyReplay(error)) {
        throw new ConflictException(ERRORS.duplicateProviderTransaction);
      }
      throw error;
    }
  }

  /**
   * Writes the opposing entry that undoes `entryId` (§46).
   *
   * The original row is never touched — that is the whole point. A reader of the
   * ledger sees both the mistake and its correction, which is what makes the
   * history defensible in a dispute.
   *
   * The reversal lands in the period given by `financialPeriodId`, normally the
   * currently open one: reversing INTO a closed month would move a sealed
   * figure, which §10 forbids.
   */
  async reverse(
    tx: Prisma.TransactionClient,
    scope: RequestScope,
    entryId: string,
    input: { financialPeriodId: string; reason: string },
  ) {
    if (!input.reason?.trim()) {
      throw new ConflictException(ERRORS.reversalReasonRequired);
    }

    const original = await tx.ledgerEntry.findFirst({
      where: { id: entryId, buildingId: scope.buildingId! },
    });
    if (!original) throw new NotFoundException(ERRORS.ledgerEntryNotFound);

    const existingReversal = await tx.ledgerEntry.findFirst({
      where: { reversesEntryId: entryId, buildingId: scope.buildingId! },
    });
    if (existingReversal) {
      throw new ConflictException(ERRORS.ledgerEntryAlreadyReversed);
    }

    await this.assertPeriodAcceptsPostings(tx, scope, input.financialPeriodId);

    const reversal = await tx.ledgerEntry.create({
      data: {
        buildingId: original.buildingId,
        unitId: original.unitId,
        financialPeriodId: input.financialPeriodId,
        // The mirror image: a debit is undone by a credit of the same size.
        direction: original.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        amount: original.amount,
        currency: original.currency,
        referenceType: 'REVERSAL',
        referenceId: original.referenceId,
        description: input.reason,
        reversesEntryId: original.id,
        occurredAt: new Date(),
        createdByPersonId: scope.personId ?? null,
      },
    });

    await this.audit.logInTransaction(tx, scope, {
      action: 'finance.ledger.reversed',
      resourceType: 'LedgerEntry',
      resourceId: original.id,
      before: { amount: toAmount(original.amount), direction: original.direction },
      after: { reversalId: reversal.id, reason: input.reason },
    });

    return reversal;
  }

  /**
   * A unit's outstanding balance, computed from entries (§28).
   *
   * Positive = the unit owes the building. This is a SUM over rows rather than a
   * stored column on purpose: it is recomputable from scratch at any time, and
   * it cannot drift from the entries that justify it.
   */
  async balanceFor(
    scope: RequestScope,
    unitId: string,
    options: { asOf?: Date } = {},
  ): Promise<{ debit: number; credit: number; outstanding: number }> {
    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: {
        buildingId: scope.buildingId!,
        unitId,
        ...(options.asOf ? { occurredAt: { lte: options.asOf } } : {}),
      },
      _sum: { amount: true },
    });

    return summarise(grouped);
  }

  /**
   * The building's aggregate position. Includes building-level entries (those
   * with a null unitId, e.g. expenses) as well as every unit's.
   */
  async buildingBalance(
    scope: RequestScope,
    options: { financialPeriodId?: string } = {},
  ): Promise<{ debit: number; credit: number; outstanding: number }> {
    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: {
        buildingId: scope.buildingId!,
        ...(options.financialPeriodId
          ? { financialPeriodId: options.financialPeriodId }
          : {}),
      },
      _sum: { amount: true },
    });

    return summarise(grouped);
  }

  /** Entry list for a statement view, newest first. */
  async list(
    scope: RequestScope,
    options: { unitId?: string; financialPeriodId?: string; take?: number } = {},
  ) {
    return this.prisma.ledgerEntry.findMany({
      where: {
        buildingId: scope.buildingId!,
        ...(options.unitId ? { unitId: options.unitId } : {}),
        ...(options.financialPeriodId
          ? { financialPeriodId: options.financialPeriodId }
          : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: options.take ?? 200,
    });
  }

  /**
   * §10 — a sealed period does not move.
   *
   * Checked here rather than in each caller because "we forgot to check on the
   * refund path" is exactly how a closed month silently changes after an auditor
   * has signed it off.
   */
  private async assertPeriodAcceptsPostings(
    tx: Prisma.TransactionClient,
    scope: RequestScope,
    financialPeriodId: string,
  ): Promise<void> {
    const period = await tx.financialPeriod.findFirst({
      where: { id: financialPeriodId, buildingId: scope.buildingId! },
      select: { status: true },
    });

    if (!period) throw new NotFoundException(ERRORS.periodNotFound);
    if (period.status === 'CLOSED') {
      throw new ConflictException(ERRORS.periodClosed);
    }
  }
}

/** Folds a groupBy result into debit/credit/outstanding. */
function summarise(
  grouped: readonly { direction: LedgerDirection; _sum: { amount: Prisma.Decimal | null } }[],
): { debit: number; credit: number; outstanding: number } {
  const debit = sum(
    grouped
      .filter((row) => row.direction === 'DEBIT')
      .map((row) => row._sum.amount ?? new Prisma.Decimal(0)),
  );
  const credit = sum(
    grouped
      .filter((row) => row.direction === 'CREDIT')
      .map((row) => row._sum.amount ?? new Prisma.Decimal(0)),
  );

  return {
    debit: toAmount(debit),
    credit: toAmount(credit),
    outstanding: toAmount(debit.minus(credit)),
  };
}

/**
 * True when a write lost the race on the (buildingId, idempotencyKey) unique.
 *
 * Matches on Prisma's structured error code rather than the message text: the
 * wording changes between driver versions, `P2002` does not. This is the same
 * lesson the ownership module learned the hard way — an untranslated unique
 * violation surfaces to the caller as a raw 500.
 */
function isIdempotencyReplay(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;

  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return fields.includes('idempotencyKey');
}
