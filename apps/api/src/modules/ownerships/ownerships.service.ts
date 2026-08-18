import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Person } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantScopedRepository } from '../../core/database/tenant-scoped.repository';
import type { RequestContext } from '../auth/auth.service';
import type {
  CloseOwnershipDto,
  CreateOwnershipDto,
  OwnerSummary,
  OwnershipResponse,
  OwnershipTransferResponse,
  TransferOwnershipDto,
  UpdateOwnershipDto,
} from './dto/ownership.dto';

/**
 * Unit ownership — temporal legal title (BM-01 §18/§19, R2).
 *
 * WHAT THIS SERVICE IS FOR: making "who owned flat 12 in Mehr 1402" answerable
 * forever. Every other property here follows from that one requirement.
 *
 * FIVE RULES IT EXISTS TO ENFORCE:
 *
 *  1. A SALE CLOSES A PERIOD AND OPENS ANOTHER — it never edits one. `transfer`
 *     does both sides in a single transaction, because a client doing it in two
 *     calls can die in the middle and leave a unit either ownerless or with two
 *     simultaneous title holders the ledger cannot split.
 *
 *  2. CLOSED PERIODS ARE IMMUTABLE. Once `periodEnd` is set, update refuses.
 *     History that can be rewritten settles no dispute.
 *
 *  3. THE SAME PERSON MAY NOT HOLD TWO OVERLAPPING PERIODS ON ONE UNIT —
 *     enforced for real by the `unit_ownerships_no_overlap` EXCLUDE constraint,
 *     mirrored here only so the ordinary case gets a Persian 409 instead of a
 *     500. DIFFERENT people overlapping is legitimate: that is joint ownership.
 *
 *  4. ACTIVE SHARES ON A UNIT MAY NOT EXCEED 100. This one CANNOT live in a DB
 *     constraint — it is a property of a SET of rows, not of any single row. It
 *     is therefore checked inside the transaction against rows locked with
 *     `SELECT ... FOR UPDATE`; without that lock two concurrent 60% inserts both
 *     read 0 and both commit, giving a unit 120% of itself.
 *
 *  5. AT MOST ONE PRIMARY OWNER AT ANY INSTANT. Promoting a new primary demotes
 *     the incumbent in the same transaction rather than rejecting, because "two
 *     owners each believing they receive statutory notice" is how legal notice
 *     gets missed.
 */
@Injectable()
export class OwnershipsService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  /**
   * Title periods in the caller's building, newest first.
   *
   * Closed periods are always included — unlike a member directory, the history
   * IS the feature here. `unitId` narrows to one unit; `currentOnly` to periods
   * in force right now.
   */
  async list(
    scope: RequestScope,
    options: { unitId?: string; personId?: string; currentOnly?: boolean } = {},
  ): Promise<OwnershipResponse[]> {
    const now = new Date();

    const rows = await this.prisma.unitOwnership.findMany({
      where: {
        ...this.tenantWhere(scope),
        ...(options.unitId ? { unitId: options.unitId } : {}),
        ...(options.personId ? { personId: options.personId } : {}),
        ...(options.currentOnly
          ? {
              periodStart: { lte: now },
              OR: [{ periodEnd: null }, { periodEnd: { gt: now } }],
            }
          : {}),
      },
      include: { person: true, unit: { select: { label: true } } },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => toResponse(row));
  }

  async findOne(
    scope: RequestScope,
    ownershipId: string,
  ): Promise<OwnershipResponse> {
    return toResponse(await this.loadRow(scope, ownershipId));
  }

  /**
   * Opens a title period.
   *
   * The share check and the insert share one transaction with a row lock; see
   * rule 4 in the class docblock for why an unlocked read-then-write is not
   * good enough here.
   */
  async create(
    scope: RequestScope,
    dto: CreateOwnershipDto,
    context: RequestContext,
  ): Promise<OwnershipResponse> {
    const buildingId = this.tenantWhere(scope).buildingId;
    const periodStart = new Date(dto.periodStart);
    const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : null;

    this.assertPeriodOrder(periodStart, periodEnd, ERRORS.ownershipEndBeforeStart);
    await this.assertUnitInBuilding(buildingId, dto.unitId);
    await this.assertPersonIsBuildingMember(
      buildingId,
      dto.personId,
      ERRORS.ownerNotBuildingMember,
    );

    const share = dto.sharePercent ?? 100;
    const isPrimary = dto.isPrimary ?? true;

    const created = await this.withConflictTranslation(() =>
      this.prisma.$transaction(async (tx) => {
        await this.assertShareFits(tx, dto.unitId, share, periodStart, periodEnd, null);

        if (isPrimary) {
          await this.demoteOtherPrimaries(tx, dto.unitId, null);
        }

        const row = await tx.unitOwnership.create({
          data: {
            buildingId,
            unitId: dto.unitId,
            personId: dto.personId,
            periodStart,
            periodEnd,
            sharePercent: new Prisma.Decimal(share),
            isPrimary,
            titleReference: dto.titleReference ?? null,
            acquiredVia: dto.acquiredVia ?? null,
            notes: dto.notes ?? null,
          },
          include: { person: true, unit: { select: { label: true } } },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'ownership.opened',
          resourceType: 'UnitOwnership',
          resourceId: row.id,
          after: row,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return row;
      }),
    );

    return toResponse(created);
  }

  /**
   * Corrects an OPEN period (rule 2 — closed rows refuse every edit).
   *
   * Note the absence of `personId`: changing who a period belongs to would
   * rewrite who owned the unit during that time. A change of owner is a
   * transfer, which is a different endpoint and a different audit action.
   */
  async update(
    scope: RequestScope,
    ownershipId: string,
    dto: UpdateOwnershipDto,
    context: RequestContext,
  ): Promise<OwnershipResponse> {
    const before = await this.loadRow(scope, ownershipId);
    if (before.periodEnd) {
      throw new ConflictException(ERRORS.ownershipClosedNotEditable);
    }

    const periodStart = dto.periodStart
      ? new Date(dto.periodStart)
      : before.periodStart;
    const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : before.periodEnd;

    this.assertPeriodOrder(periodStart, periodEnd, ERRORS.ownershipEndBeforeStart);

    const share = dto.sharePercent ?? Number(before.sharePercent);

    const updated = await this.withConflictTranslation(() =>
      this.prisma.$transaction(async (tx) => {
        await this.assertShareFits(
          tx,
          before.unitId,
          share,
          periodStart,
          periodEnd,
          before.id,
        );

        if (dto.isPrimary === true) {
          await this.demoteOtherPrimaries(tx, before.unitId, before.id);
        }

        const row = await tx.unitOwnership.update({
          where: { id: before.id },
          data: {
            periodStart,
            periodEnd,
            ...(dto.sharePercent !== undefined
              ? { sharePercent: new Prisma.Decimal(dto.sharePercent) }
              : {}),
            ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
            ...(dto.titleReference !== undefined
              ? { titleReference: dto.titleReference }
              : {}),
            ...(dto.acquiredVia !== undefined
              ? { acquiredVia: dto.acquiredVia }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          },
          include: { person: true, unit: { select: { label: true } } },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'ownership.updated',
          resourceType: 'UnitOwnership',
          resourceId: row.id,
          before,
          after: row,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return row;
      }),
    );

    return toResponse(updated);
  }

  /**
   * Ends an open period. This is the closest thing to a delete that exists, and
   * deliberately so — the row stays, it just stops being current.
   */
  async close(
    scope: RequestScope,
    ownershipId: string,
    dto: CloseOwnershipDto,
    context: RequestContext,
  ): Promise<OwnershipResponse> {
    const before = await this.loadRow(scope, ownershipId);
    if (before.periodEnd) {
      throw new ConflictException(ERRORS.ownershipAlreadyClosed);
    }

    const endedAt = dto.endedAt ? new Date(dto.endedAt) : new Date();
    if (endedAt <= before.periodStart) {
      throw new BadRequestException(ERRORS.ownershipEndBeforeStart);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.unitOwnership.update({
        where: { id: before.id },
        data: {
          periodEnd: endedAt,
          ...(dto.reason
            ? { notes: appendNote(before.notes, dto.reason) }
            : {}),
        },
        include: { person: true, unit: { select: { label: true } } },
      });

      await this.audit.logInTransaction(tx, scope, {
        action: 'ownership.closed',
        resourceType: 'UnitOwnership',
        resourceId: row.id,
        before,
        after: row,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return row;
    });

    return toResponse(updated);
  }

  /**
   * Sells a unit: closes the seller's period(s) and opens the buyer's at the
   * same instant, atomically (rule 1).
   *
   * The half-open interval is what makes this expressible without a gap — a
   * period ending at T does not overlap one starting at T, so the unit is never
   * ownerless for a second and never doubly owned for a second.
   */
  async transfer(
    scope: RequestScope,
    dto: TransferOwnershipDto,
    context: RequestContext,
  ): Promise<OwnershipTransferResponse> {
    const buildingId = this.tenantWhere(scope).buildingId;
    const at = new Date(dto.transferredAt);

    await this.assertUnitInBuilding(buildingId, dto.unitId);
    await this.assertPersonIsBuildingMember(
      buildingId,
      dto.toPersonId,
      ERRORS.ownerNotBuildingMember,
    );

    const result = await this.withConflictTranslation(() =>
      this.prisma.$transaction(async (tx) => {
        const open = await tx.unitOwnership.findMany({
          where: {
            buildingId,
            unitId: dto.unitId,
            periodEnd: null,
            ...(dto.fromPersonId ? { personId: dto.fromPersonId } : {}),
          },
          include: { person: true, unit: { select: { label: true } } },
        });

        // A period cannot end before it began: transferring at an instant that
        // predates an open period would trip the period_order CHECK as a raw
        // 500, so it is refused here with a readable message instead.
        for (const row of open) {
          if (at <= row.periodStart) {
            throw new BadRequestException(ERRORS.ownershipEndBeforeStart);
          }
        }

        const closed: typeof open = [];
        for (const row of open) {
          const updatedRow = await tx.unitOwnership.update({
            where: { id: row.id },
            data: { periodEnd: at },
            include: { person: true, unit: { select: { label: true } } },
          });
          closed.push(updatedRow);
        }

        // The incoming share defaults to whatever the outgoing owners held in
        // total, so a straightforward whole-unit sale needs no share arithmetic
        // from the client and still lands on exactly 100.
        const outgoingShare = open.reduce(
          (sum, row) => sum + Number(row.sharePercent),
          0,
        );
        const share = dto.sharePercent ?? (outgoingShare > 0 ? outgoingShare : 100);

        await this.assertShareFits(tx, dto.unitId, share, at, null, null);

        await this.demoteOtherPrimaries(tx, dto.unitId, null);

        const opened = await tx.unitOwnership.create({
          data: {
            buildingId,
            unitId: dto.unitId,
            personId: dto.toPersonId,
            periodStart: at,
            periodEnd: null,
            sharePercent: new Prisma.Decimal(share),
            isPrimary: true,
            titleReference: dto.titleReference ?? null,
            acquiredVia: dto.acquiredVia ?? null,
            notes: dto.notes ?? null,
          },
          include: { person: true, unit: { select: { label: true } } },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'ownership.transferred',
          resourceType: 'UnitOwnership',
          resourceId: opened.id,
          before: { closed: closed.map((row) => row.id) },
          after: opened,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return { closed, opened };
      }),
    );

    return {
      closed: result.closed.map((row) => toResponse(row)),
      opened: toResponse(result.opened),
    };
  }

  // -------------------------------------------------------------------------
  //  internals
  // -------------------------------------------------------------------------

  /**
   * Loads a row inside the caller's building.
   *
   * NotFound rather than Forbidden on a foreign id: confirming "that row exists
   * but is not yours" would let a caller enumerate other tenants' records.
   */
  private async loadRow(scope: RequestScope, ownershipId: string) {
    const row = await this.prisma.unitOwnership.findFirst({
      where: { id: ownershipId, ...this.tenantWhere(scope) },
      include: { person: true, unit: { select: { label: true } } },
    });
    if (!row) throw new NotFoundException(ERRORS.notFound);
    return row;
  }

  private assertPeriodOrder(
    start: Date,
    end: Date | null,
    message: string,
  ): void {
    if (end && end <= start) throw new BadRequestException(message);
  }

  /** The unit must belong to the building the guard proved (§36). */
  private async assertUnitInBuilding(
    buildingId: string,
    unitId: string,
  ): Promise<void> {
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, buildingId },
      select: { id: true },
    });
    if (!unit) throw new NotFoundException(ERRORS.unitNotInBuilding);
  }

  /**
   * Title may only be held by someone who already belongs to the building.
   * ENDED memberships do not count — a former resident should be re-invited,
   * not silently re-attached by an ownership write.
   */
  private async assertPersonIsBuildingMember(
    buildingId: string,
    personId: string,
    message: string,
  ): Promise<void> {
    const membership = await this.prisma.buildingMembership.findFirst({
      where: { buildingId, personId, status: { not: 'ENDED' } },
      select: { id: true },
    });
    if (!membership) throw new ConflictException(message);
  }

  /**
   * Enforces "active shares on a unit sum to at most 100" (rule 4).
   *
   * THE LOCK IS THE WHOLE POINT. `SELECT ... FOR UPDATE` on the unit's open rows
   * serialises concurrent writers: without it two simultaneous 60% inserts both
   * read a total of 0, both pass, and both commit — leaving a unit that is 120%
   * owned and a charge split that cannot be reconciled. No EXCLUDE constraint
   * can express this, because it is a property of the SET of rows rather than
   * of any single row.
   *
   * Only periods that OVERLAP the candidate's window are counted; two owners in
   * sequence are not a conflict.
   */
  private async assertShareFits(
    tx: Prisma.TransactionClient,
    unitId: string,
    share: number,
    periodStart: Date,
    periodEnd: Date | null,
    excludeId: string | null,
  ): Promise<void> {
    if (share <= 0 || share > 100) {
      throw new BadRequestException(ERRORS.ownershipSharePositive);
    }

    const rows = await tx.$queryRaw<{ sharePercent: Prisma.Decimal }[]>`
      SELECT "sharePercent"
      FROM unit_ownerships
      WHERE "unitId" = ${unitId}::uuid
        AND ("periodEnd" IS NULL OR "periodEnd" > ${periodStart})
        AND (${periodEnd}::timestamptz IS NULL OR "periodStart" < ${periodEnd})
        AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)
      FOR UPDATE
    `;

    const existing = rows.reduce((sum, row) => sum + Number(row.sharePercent), 0);

    // Rounded to 3 decimals to match the Decimal(6,3) column — otherwise
    // 33.333 * 3 fails a naive > 100 comparison on floating-point dust.
    if (Math.round((existing + share) * 1000) / 1000 > 100) {
      throw new ConflictException(ERRORS.ownershipShareExceeded);
    }
  }

  /** Keeps "at most one primary owner per unit" true (rule 5). */
  private async demoteOtherPrimaries(
    tx: Prisma.TransactionClient,
    unitId: string,
    excludeId: string | null,
  ): Promise<void> {
    await tx.unitOwnership.updateMany({
      where: {
        unitId,
        isPrimary: true,
        periodEnd: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      data: { isPrimary: false },
    });
  }

  /**
   * Converts the database's own rejections into the same Persian 409 the
   * application-level checks produce.
   *
   * The EXCLUDE constraint is the real guarantee — evaluated at commit time, so
   * it catches the interleaving that two concurrent requests slip through the
   * read-then-write checks with. Without this translation the loser of that
   * race sees an opaque 500.
   */
  private async withConflictTranslation<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isOwnershipOverlapViolation(error)) {
        throw new ConflictException(ERRORS.ownershipPeriodOverlap);
      }
      throw error;
    }
  }
}

/** Row shape this service reads, narrowed for the mapper. */
type OwnershipRow = {
  id: string;
  buildingId: string;
  unitId: string;
  periodStart: Date;
  periodEnd: Date | null;
  sharePercent: Prisma.Decimal;
  isPrimary: boolean;
  titleReference: string | null;
  acquiredVia: string | null;
  notes: string | null;
  createdAt: Date;
  person: Person;
  unit: { label: string | null };
};

/**
 * Maps a row onto the response shape.
 *
 * `sharePercent` is converted with Number() because Prisma.Decimal serialises
 * as an object over JSON — a client doing arithmetic on `{s,e,d}` gets NaN.
 * Contact details are deliberately absent: knowing WHO owns a unit does not
 * entitle the reader to their phone number (BM-00 rule 6), which stays behind
 * PERSON_READ_CONTACT in the member directory.
 */
function toResponse(row: OwnershipRow): OwnershipResponse {
  const now = new Date();
  return {
    id: row.id,
    buildingId: row.buildingId,
    unitId: row.unitId,
    unitLabel: row.unit.label,
    owner: toOwnerSummary(row.person),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    isCurrent:
      row.periodStart <= now &&
      (row.periodEnd === null || row.periodEnd > now),
    sharePercent: Number(row.sharePercent),
    isPrimary: row.isPrimary,
    titleReference: row.titleReference,
    acquiredVia: row.acquiredVia,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

function toOwnerSummary(person: Person): OwnerSummary {
  return {
    personId: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    displayName: person.displayName,
  };
}

/** Appends a closing reason without discarding what was already recorded (R2). */
function appendNote(existing: string | null, addition: string): string {
  return existing ? `${existing}\n${addition}` : addition;
}

/**
 * True for the Postgres rejection raised by `unit_ownerships_no_overlap`.
 *
 * Matched on the constraint NAME as well as SQLSTATE 23P01 so that an unrelated
 * exclusion violation — the occupancy one, for instance — is not mislabelled as
 * an ownership overlap.
 */
function isOwnershipOverlapViolation(error: unknown): boolean {
  const text =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? `${error.code} ${error.message}`
      : error instanceof Error
        ? error.message
        : '';

  return (
    text.includes('unit_ownerships_no_overlap') ||
    (text.includes('23P01') && text.includes('unit_ownerships'))
  );
}
