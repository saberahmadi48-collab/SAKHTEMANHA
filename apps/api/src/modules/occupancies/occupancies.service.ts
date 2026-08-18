import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type OccupancyKind, type Person } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantScopedRepository } from '../../core/database/tenant-scoped.repository';
import type { RequestContext } from '../auth/auth.service';
import type {
  CreateOccupancyDto,
  MoveInDto,
  MoveOutDto,
  OccupancyMoveResponse,
  OccupancyResponse,
  OccupantSummary,
  UpdateOccupancyDto,
} from './dto/occupancy.dto';

/**
 * Unit occupancy — who physically lives or operates in a unit (BM-01 §20).
 *
 * WHY THIS IS SEPARATE FROM OWNERSHIP: the biller and the resident are often
 * different people, and BM-03 splits charges on exactly that line — fixed
 * charges follow title, consumption charges follow the occupant. Collapsing the
 * two would make a landlord's water bill unattributable.
 *
 * FOUR RULES THIS SERVICE EXISTS TO ENFORCE:
 *
 *  1. ONE OCCUPANCY PER UNIT AT ANY INSTANT — strictly stricter than ownership.
 *     A flat cannot be simultaneously VACANT and tenanted, so the
 *     `unit_occupancies_no_overlap` EXCLUDE constraint keys on `unitId` ALONE
 *     (no personId). Mirrored here only so the ordinary case gets a Persian 409
 *     rather than a 500.
 *
 *  2. VACANT MEANS NOBODY. `kind = VACANT` requires `personId` to be null and
 *     every other kind requires it to be set. Enforced here and again by the
 *     `unit_occupancies_person_matches_kind` CHECK — "empty flat, resident
 *     Ahmad" is a contradiction the ledger cannot bill.
 *
 *  3. A MOVE IS ATOMIC. `moveIn` closes the outgoing period and opens the
 *     incoming one in a single transaction. Rule 1 is precisely what makes the
 *     client-side two-call version impossible: create-then-close is rejected as
 *     an overlap, and close-then-create leaves the unit unoccupied if the second
 *     call never lands.
 *
 *  4. CLOSED PERIODS ARE IMMUTABLE (R2). Last winter's heating bill was split by
 *     who lived there then; a history that can be rewritten settles no dispute.
 */
@Injectable()
export class OccupanciesService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  /**
   * Occupancy periods in the caller's building, newest first.
   *
   * Closed periods are always included — the history IS the feature. `unitId`
   * narrows to one unit; `currentOnly` to periods in force right now.
   */
  async list(
    scope: RequestScope,
    options: { unitId?: string; personId?: string; currentOnly?: boolean } = {},
  ): Promise<OccupancyResponse[]> {
    const now = new Date();

    const rows = await this.prisma.unitOccupancy.findMany({
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
    occupancyId: string,
  ): Promise<OccupancyResponse> {
    return toResponse(await this.loadRow(scope, occupancyId));
  }

  /** Opens an occupancy period. Refuses if anything already occupies the window. */
  async create(
    scope: RequestScope,
    dto: CreateOccupancyDto,
    context: RequestContext,
  ): Promise<OccupancyResponse> {
    const buildingId = this.tenantWhere(scope).buildingId;
    const periodStart = new Date(dto.periodStart);
    const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : null;
    const kind: OccupancyKind = dto.kind ?? 'OWNER_OCCUPIED';

    this.assertPeriodOrder(periodStart, periodEnd);
    this.assertPersonMatchesKind(kind, dto.personId ?? null);
    await this.assertUnitInBuilding(buildingId, dto.unitId);

    if (dto.personId) {
      await this.assertPersonIsBuildingMember(buildingId, dto.personId);
    }

    // Read-then-write race is covered by the EXCLUDE constraint; this check
    // exists so the ordinary case returns a Persian 409 instead of a 500.
    await this.assertNoOverlap(dto.unitId, periodStart, periodEnd, null);

    const created = await this.withConflictTranslation(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.unitOccupancy.create({
          data: {
            buildingId,
            unitId: dto.unitId,
            personId: dto.personId ?? null,
            kind,
            periodStart,
            periodEnd,
            residentCount: dto.residentCount ?? (kind === 'VACANT' ? 0 : 1),
            leaseReference: dto.leaseReference ?? null,
            leaseStartsAt: dto.leaseStartsAt ? new Date(dto.leaseStartsAt) : null,
            leaseEndsAt: dto.leaseEndsAt ? new Date(dto.leaseEndsAt) : null,
            notes: dto.notes ?? null,
          },
          include: { person: true, unit: { select: { label: true } } },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'occupancy.opened',
          resourceType: 'UnitOccupancy',
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
   * Corrects an OPEN period (rule 4 — closed rows refuse every edit).
   *
   * Changing `kind` re-checks the person/kind pairing against the row's EXISTING
   * person, because switching an occupied period to VACANT without clearing the
   * occupant would otherwise reach the DB and fail as a raw CHECK violation.
   */
  async update(
    scope: RequestScope,
    occupancyId: string,
    dto: UpdateOccupancyDto,
    context: RequestContext,
  ): Promise<OccupancyResponse> {
    const before = await this.loadRow(scope, occupancyId);
    if (before.periodEnd) {
      throw new ConflictException(ERRORS.occupancyClosedNotEditable);
    }

    const periodStart = dto.periodStart
      ? new Date(dto.periodStart)
      : before.periodStart;
    const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : before.periodEnd;
    const kind: OccupancyKind = dto.kind ?? before.kind;

    this.assertPeriodOrder(periodStart, periodEnd);
    this.assertPersonMatchesKind(kind, before.personId);

    if (dto.periodStart || dto.periodEnd) {
      await this.assertNoOverlap(before.unitId, periodStart, periodEnd, before.id);
    }

    const updated = await this.withConflictTranslation(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.unitOccupancy.update({
          where: { id: before.id },
          data: {
            kind,
            periodStart,
            periodEnd,
            ...(dto.residentCount !== undefined
              ? { residentCount: dto.residentCount }
              : {}),
            ...(dto.leaseReference !== undefined
              ? { leaseReference: dto.leaseReference }
              : {}),
            ...(dto.leaseStartsAt !== undefined
              ? { leaseStartsAt: new Date(dto.leaseStartsAt) }
              : {}),
            ...(dto.leaseEndsAt !== undefined
              ? { leaseEndsAt: new Date(dto.leaseEndsAt) }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          },
          include: { person: true, unit: { select: { label: true } } },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'occupancy.updated',
          resourceType: 'UnitOccupancy',
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
   * Ends an open occupancy — a move-out.
   *
   * With `leaveVacant`, a VACANT period opens at the same instant so the unit's
   * timeline has no hole. Off by default: a move-out immediately followed by a
   * new tenant should not have a phantom vacancy wedged between them.
   */
  async moveOut(
    scope: RequestScope,
    occupancyId: string,
    dto: MoveOutDto,
    context: RequestContext,
  ): Promise<OccupancyResponse> {
    const before = await this.loadRow(scope, occupancyId);
    if (before.periodEnd) {
      throw new ConflictException(ERRORS.occupancyAlreadyClosed);
    }

    const movedOutAt = dto.movedOutAt ? new Date(dto.movedOutAt) : new Date();
    if (movedOutAt <= before.periodStart) {
      throw new BadRequestException(ERRORS.occupancyEndBeforeStart);
    }

    const updated = await this.withConflictTranslation(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.unitOccupancy.update({
          where: { id: before.id },
          data: {
            periodEnd: movedOutAt,
            ...(dto.reason ? { notes: appendNote(before.notes, dto.reason) } : {}),
          },
          include: { person: true, unit: { select: { label: true } } },
        });

        if (dto.leaveVacant) {
          await tx.unitOccupancy.create({
            data: {
              buildingId: before.buildingId,
              unitId: before.unitId,
              personId: null,
              kind: 'VACANT',
              periodStart: movedOutAt,
              periodEnd: null,
              residentCount: 0,
            },
          });
        }

        await this.audit.logInTransaction(tx, scope, {
          action: 'occupancy.closed',
          resourceType: 'UnitOccupancy',
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
   * Moves someone in: closes whatever occupies the unit and opens the new
   * period at the same instant, atomically (rule 3).
   *
   * Half-open intervals are what make this expressible — a period ending at T
   * does not overlap one starting at T — so the unit is neither doubly occupied
   * nor unoccupied for an instant.
   */
  async moveIn(
    scope: RequestScope,
    dto: MoveInDto,
    context: RequestContext,
  ): Promise<OccupancyMoveResponse> {
    const buildingId = this.tenantWhere(scope).buildingId;
    const at = new Date(dto.movedInAt);
    const kind: OccupancyKind = dto.kind ?? 'TENANT';

    this.assertPersonMatchesKind(kind, dto.personId ?? null);
    await this.assertUnitInBuilding(buildingId, dto.unitId);

    if (dto.personId) {
      await this.assertPersonIsBuildingMember(buildingId, dto.personId);
    }

    const result = await this.withConflictTranslation(() =>
      this.prisma.$transaction(async (tx) => {
        const open = await tx.unitOccupancy.findFirst({
          where: { buildingId, unitId: dto.unitId, periodEnd: null },
          include: { person: true, unit: { select: { label: true } } },
        });

        let closed: typeof open = null;
        if (open) {
          // A period cannot end before it began: moving in at an instant that
          // predates the sitting occupancy would trip the period_order CHECK as
          // a raw 500, so it is refused here with a readable message.
          if (at <= open.periodStart) {
            throw new BadRequestException(ERRORS.occupancyEndBeforeStart);
          }
          closed = await tx.unitOccupancy.update({
            where: { id: open.id },
            data: { periodEnd: at },
            include: { person: true, unit: { select: { label: true } } },
          });
        }

        const opened = await tx.unitOccupancy.create({
          data: {
            buildingId,
            unitId: dto.unitId,
            personId: dto.personId ?? null,
            kind,
            periodStart: at,
            periodEnd: null,
            residentCount: dto.residentCount ?? (kind === 'VACANT' ? 0 : 1),
            leaseReference: dto.leaseReference ?? null,
            leaseStartsAt: dto.leaseStartsAt ? new Date(dto.leaseStartsAt) : null,
            leaseEndsAt: dto.leaseEndsAt ? new Date(dto.leaseEndsAt) : null,
            notes: dto.notes ?? null,
          },
          include: { person: true, unit: { select: { label: true } } },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'occupancy.moved_in',
          resourceType: 'UnitOccupancy',
          resourceId: opened.id,
          before: closed ? { closedId: closed.id } : undefined,
          after: opened,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return { closed, opened };
      }),
    );

    return {
      closed: result.closed ? toResponse(result.closed) : null,
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
  private async loadRow(scope: RequestScope, occupancyId: string) {
    const row = await this.prisma.unitOccupancy.findFirst({
      where: { id: occupancyId, ...this.tenantWhere(scope) },
      include: { person: true, unit: { select: { label: true } } },
    });
    if (!row) throw new NotFoundException(ERRORS.notFound);
    return row;
  }

  private assertPeriodOrder(start: Date, end: Date | null): void {
    if (end && end <= start) {
      throw new BadRequestException(ERRORS.occupancyEndBeforeStart);
    }
  }

  /**
   * Rule 2, checked before the database sees it.
   *
   * The `unit_occupancies_person_matches_kind` CHECK enforces the same pairing,
   * but a CHECK violation surfaces as an opaque 500; this turns it into a
   * readable Persian 400 in the ordinary case.
   */
  private assertPersonMatchesKind(
    kind: OccupancyKind,
    personId: string | null,
  ): void {
    if (kind === 'VACANT' && personId) {
      throw new BadRequestException(ERRORS.vacantMustHaveNoOccupant);
    }
    if (kind !== 'VACANT' && !personId) {
      throw new BadRequestException(ERRORS.occupantRequired);
    }
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
   * An occupant must already belong to the building. ENDED memberships do not
   * count — a former resident should be re-invited, not silently re-attached by
   * an occupancy write.
   */
  private async assertPersonIsBuildingMember(
    buildingId: string,
    personId: string,
  ): Promise<void> {
    const membership = await this.prisma.buildingMembership.findFirst({
      where: { buildingId, personId, status: { not: 'ENDED' } },
      select: { id: true },
    });
    if (!membership) {
      throw new ConflictException(ERRORS.occupantNotBuildingMember);
    }
  }

  /**
   * Application-level overlap check mirroring `unit_occupancies_no_overlap`.
   *
   * Note it keys on `unitId` alone — no personId. That is the deliberate
   * difference from ownership: joint title is legitimate, joint physical
   * occupancy of the same period is not.
   */
  private async assertNoOverlap(
    unitId: string,
    periodStart: Date,
    periodEnd: Date | null,
    excludeId: string | null,
  ): Promise<void> {
    const clash = await this.prisma.unitOccupancy.findFirst({
      where: {
        unitId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        // existing.periodStart < new.periodEnd AND existing.periodEnd > new.periodStart
        ...(periodEnd ? { periodStart: { lt: periodEnd } } : {}),
        OR: [{ periodEnd: null }, { periodEnd: { gt: periodStart } }],
      },
      select: { id: true },
    });

    if (clash) {
      throw new ConflictException(ERRORS.occupancyPeriodOverlap);
    }
  }

  /**
   * Converts the database's own rejections into the same Persian 409 the
   * application-level checks produce.
   *
   * The EXCLUDE constraint is the real guarantee — evaluated at commit time, so
   * it catches the interleaving that two concurrent move-ins slip through the
   * read-then-write check with. Without this translation the loser sees a 500.
   */
  private async withConflictTranslation<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isOccupancyOverlapViolation(error)) {
        throw new ConflictException(ERRORS.occupancyPeriodOverlap);
      }
      throw error;
    }
  }
}

/** Row shape this service reads, narrowed for the mapper. */
type OccupancyRow = {
  id: string;
  buildingId: string;
  unitId: string;
  kind: OccupancyKind;
  periodStart: Date;
  periodEnd: Date | null;
  residentCount: number;
  leaseReference: string | null;
  leaseStartsAt: Date | null;
  leaseEndsAt: Date | null;
  notes: string | null;
  createdAt: Date;
  person: Person | null;
  unit: { label: string | null };
};

/**
 * Maps a row onto the response shape.
 *
 * Contact details are deliberately absent: knowing WHO lives in a unit does not
 * entitle the reader to their phone number (BM-00 rule 6), which stays behind
 * PERSON_READ_CONTACT in the member directory.
 */
function toResponse(row: OccupancyRow): OccupancyResponse {
  const now = new Date();
  return {
    id: row.id,
    buildingId: row.buildingId,
    unitId: row.unitId,
    unitLabel: row.unit.label,
    occupant: row.person ? toOccupantSummary(row.person) : null,
    kind: row.kind,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    isCurrent:
      row.periodStart <= now && (row.periodEnd === null || row.periodEnd > now),
    residentCount: row.residentCount,
    leaseReference: row.leaseReference,
    leaseStartsAt: row.leaseStartsAt,
    leaseEndsAt: row.leaseEndsAt,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

function toOccupantSummary(person: Person): OccupantSummary {
  return {
    personId: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    displayName: person.displayName,
  };
}

/** Appends a reason without discarding what was already recorded (R2). */
function appendNote(existing: string | null, addition: string): string {
  return existing ? `${existing}\n${addition}` : addition;
}

/**
 * True for the Postgres rejection raised by `unit_occupancies_no_overlap`.
 *
 * Matched on the constraint NAME as well as SQLSTATE 23P01 so that an unrelated
 * exclusion violation — the ownership one, for instance — is not mislabelled as
 * an occupancy clash.
 */
function isOccupancyOverlapViolation(error: unknown): boolean {
  const text =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? `${error.code} ${error.message}`
      : error instanceof Error
        ? error.message
        : '';

  return (
    text.includes('unit_occupancies_no_overlap') ||
    (text.includes('23P01') && text.includes('unit_occupancies'))
  );
}
