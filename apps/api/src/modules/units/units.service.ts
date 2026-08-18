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
import type { RequestContext } from '../auth/auth.service';
import type {
  CreateUnitDto,
  GenerateUnitsDto,
  GenerateUnitsResponse,
  UnitResponse,
  UpdateUnitDto,
} from './dto/unit.dto';

/**
 * Units — the chargeable spaces inside a building (BM-01 §13–§17, §36).
 *
 * EXTENDS TenantScopedRepository DELIBERATELY. BuildingScopeGuard already
 * proved the caller may touch this building, but that is one layer, and a guard
 * is something a future route can forget to apply. `tenantWhere(scope)` makes
 * the buildingId predicate part of the data access itself, so even a query
 * written six months from now cannot accidentally span tenants. Defence in
 * depth is the explicit ask of BM-01 §31 and §39.
 *
 * WHAT THIS SERVICE REFUSES TO DO:
 *   - delete a unit. §16 says a vacant unit stays part of the building, and
 *     BM-00 rule 4 forbids destroying history. Archiving sets `archivedAt`.
 *   - record who owns or occupies it. Those are temporal relations owned by
 *     BM-02; putting them here would turn "sold in March" into an overwrite.
 *   - decide anything financial. §17: area and share ratio are STORED here and
 *     interpreted by BM-03.
 */
@Injectable()
export class UnitsService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  /** Creates one unit in the caller's proven building. */
  async create(
    scope: RequestScope,
    dto: CreateUnitDto,
    context: RequestContext,
  ): Promise<UnitResponse> {
    const building = await this.loadMutableBuilding(scope);

    const unit = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.unit.create({
          data: {
            buildingId: building.id,
            label: dto.label,
            kind: dto.kind ?? 'RESIDENTIAL',
            status: dto.status ?? 'ACTIVE',
            floor: dto.floor ?? null,
            block: dto.block ?? null,
            areaSqm: dto.areaSqm ?? null,
            bedroomCount: dto.bedroomCount ?? null,
            shareRatio: dto.shareRatio ?? null,
            parkingSpots: dto.parkingSpots ?? 0,
            storageUnits: dto.storageUnits ?? 0,
          },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'unit.created',
          resourceType: 'Unit',
          resourceId: created.id,
          after: created,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return created;
      })
      .catch((error: unknown) => {
        // Unique (buildingId, label) — §36 "unit identifiers must be unique
        // within a Building". The index is the authority, not a pre-check.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(ERRORS.unitLabelTaken);
        }
        throw error;
      });

    return toUnitResponse(unit);
  }

  /**
   * Bulk-creates units from a floor plan (§32 "define unit structure", §36
   * automatic numbering).
   *
   * EXISTING LABELS ARE SKIPPED, NEVER OVERWRITTEN. Re-running a generation
   * after adding one floor must not touch the units already carrying ownership
   * and ledger history (§14). The response reports exactly what was skipped so
   * the outcome is visible rather than silently partial.
   */
  async generate(
    scope: RequestScope,
    dto: GenerateUnitsDto,
    context: RequestContext,
  ): Promise<GenerateUnitsResponse> {
    const building = await this.loadMutableBuilding(scope);

    const planned = buildLabelPlan(dto);

    const existing = await this.prisma.unit.findMany({
      where: {
        ...this.tenantWhere(scope),
        label: { in: planned.map((entry) => entry.label) },
      },
      select: { label: true },
    });
    // Compared lowercased because the column is citext: "p-101" and "P-101" are
    // the same row to Postgres, and a case-sensitive JS Set would miss that and
    // then hit a unique-violation mid-transaction.
    const taken = new Set(existing.map((row) => row.label.toLowerCase()));

    const toCreate = planned.filter(
      (entry) => !taken.has(entry.label.toLowerCase()),
    );
    const skipped = planned
      .filter((entry) => taken.has(entry.label.toLowerCase()))
      .map((entry) => entry.label);

    if (toCreate.length === 0) {
      return { created: [], skipped };
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const rows = [];
      for (const entry of toCreate) {
        rows.push(
          await tx.unit.create({
            data: {
              buildingId: building.id,
              label: entry.label,
              kind: entry.kind,
              status: 'ACTIVE',
              floor: entry.floor,
              areaSqm: entry.areaSqm ?? null,
            },
          }),
        );
      }

      // One audit row for the whole batch: 24 near-identical rows would bury
      // the interesting events, and the batch IS the action a human took.
      await this.audit.logInTransaction(tx, scope, {
        action: 'unit.batch_created',
        resourceType: 'Unit',
        resourceId: building.id,
        after: {
          createdCount: rows.length,
          skippedCount: skipped.length,
          labels: rows.map((row) => row.label),
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return rows;
    });

    return { created: created.map(toUnitResponse), skipped };
  }

  /**
   * Units of the caller's building.
   *
   * Archived units are excluded from the default list but still exist and are
   * still reachable by id — §16 is explicit that a unit is not deleted merely
   * because nobody occupies it.
   */
  async list(
    scope: RequestScope,
    includeArchived = false,
  ): Promise<UnitResponse[]> {
    const units = await this.prisma.unit.findMany({
      where: {
        ...this.tenantWhere(scope),
        ...(includeArchived ? {} : this.notArchivedWhere()),
      },
      orderBy: [{ floor: 'asc' }, { label: 'asc' }],
    });
    return units.map(toUnitResponse);
  }

  /**
   * One unit by id.
   *
   * `tenantWhere` is spread into the lookup rather than the id being used
   * alone: a unit id from another building simply does not match, so an IDOR
   * attempt returns 404 without ever loading the row (§39 BOLA protection).
   */
  async findOne(scope: RequestScope, unitId: string): Promise<UnitResponse> {
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, ...this.tenantWhere(scope) },
    });
    if (!unit) throw new NotFoundException(ERRORS.notFound);
    return toUnitResponse(unit);
  }

  async update(
    scope: RequestScope,
    unitId: string,
    dto: UpdateUnitDto,
    context: RequestContext,
  ): Promise<UnitResponse> {
    await this.loadMutableBuilding(scope);

    const before = await this.prisma.unit.findFirst({
      where: { id: unitId, ...this.tenantWhere(scope) },
    });
    if (!before) throw new NotFoundException(ERRORS.notFound);

    if (before.archivedAt) {
      // An archived unit is history. Editing it would rewrite the record a past
      // manager is accountable for (BM-00 rule 19).
      throw new ConflictException(ERRORS.cannotDeleteHistorical);
    }

    const data: Prisma.UnitUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.floor !== undefined) data.floor = dto.floor;
    if (dto.block !== undefined) data.block = dto.block;
    if (dto.areaSqm !== undefined) data.areaSqm = dto.areaSqm;
    if (dto.bedroomCount !== undefined) data.bedroomCount = dto.bedroomCount;
    if (dto.shareRatio !== undefined) data.shareRatio = dto.shareRatio;
    if (dto.parkingSpots !== undefined) data.parkingSpots = dto.parkingSpots;
    if (dto.storageUnits !== undefined) data.storageUnits = dto.storageUnits;

    if (Object.keys(data).length === 0) return toUnitResponse(before);

    const updated = await this.prisma.unit
      .update({ where: { id: before.id }, data })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(ERRORS.unitLabelTaken);
        }
        throw error;
      });

    await this.audit.log(scope, {
      action: 'unit.updated',
      resourceType: 'Unit',
      resourceId: updated.id,
      before,
      after: updated,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return toUnitResponse(updated);
  }

  /**
   * Archives a unit — a SOFT delete (§16, BM-00 rule 4).
   *
   * REFUSES while anyone still owns or occupies it. Archiving a unit out from
   * under a live ownership row would leave a person holding title to something
   * the platform treats as gone, and BM-03 would raise charges against it.
   * Close the ownership/occupancy periods first (BM-02), then archive.
   */
  async archive(
    scope: RequestScope,
    unitId: string,
    context: RequestContext,
  ): Promise<UnitResponse> {
    await this.loadMutableBuilding(scope);

    const before = await this.prisma.unit.findFirst({
      where: { id: unitId, ...this.tenantWhere(scope) },
    });
    if (!before) throw new NotFoundException(ERRORS.notFound);
    if (before.archivedAt) return toUnitResponse(before);

    const now = new Date();
    const [liveOwnerships, liveOccupancies] = await Promise.all([
      this.prisma.unitOwnership.count({
        where: {
          unitId: before.id,
          periodStart: { lte: now },
          OR: [{ periodEnd: null }, { periodEnd: { gt: now } }],
        },
      }),
      this.prisma.unitOccupancy.count({
        where: {
          unitId: before.id,
          kind: { not: 'VACANT' },
          periodStart: { lte: now },
          OR: [{ periodEnd: null }, { periodEnd: { gt: now } }],
        },
      }),
    ]);

    if (liveOwnerships > 0 || liveOccupancies > 0) {
      throw new ConflictException(ERRORS.conflict);
    }

    const updated = await this.prisma.unit.update({
      where: { id: before.id },
      data: { status: 'ARCHIVED', archivedAt: now },
    });

    await this.audit.log(scope, {
      action: 'unit.archived',
      resourceType: 'Unit',
      resourceId: updated.id,
      before,
      after: updated,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return toUnitResponse(updated);
  }

  /**
   * Loads the scoped building and refuses if it is in a historical state.
   *
   * Every mutation goes through here, so "you cannot add units to an archived
   * building" is stated once rather than remembered in five places.
   */
  private async loadMutableBuilding(scope: RequestScope) {
    const { buildingId } = this.tenantWhere(scope);

    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true, status: true, archivedAt: true },
    });
    if (!building) throw new NotFoundException(ERRORS.notFound);

    if (
      building.archivedAt ||
      building.status === 'ARCHIVED' ||
      building.status === 'DECOMMISSIONED'
    ) {
      throw new ConflictException(ERRORS.buildingArchived);
    }
    return building;
  }
}

/** One unit the generator intends to create. */
interface PlannedUnit {
  readonly label: string;
  readonly floor: number;
  readonly kind: NonNullable<CreateUnitDto['kind']>;
  readonly areaSqm?: number;
}

/**
 * Expands a floor plan into concrete labels (§36 automatic numbering).
 *
 * Labels follow the `floor * 100 + index` convention Iranian buildings use
 * (101, 102, 201…). Negative floors — parking and storage levels — would
 * produce "-101", so they are rendered as "B1-01": a minus sign in a unit
 * label reads as a typo and sorts unpredictably.
 *
 * Duplicate labels WITHIN one request are dropped here rather than left to the
 * database, because a unique violation mid-transaction would roll back the
 * whole batch and give the user nothing.
 */
function buildLabelPlan(dto: GenerateUnitsDto): PlannedUnit[] {
  const planned: PlannedUnit[] = [];
  const seen = new Set<string>();
  const prefix = dto.labelPrefix ? `${dto.labelPrefix}-` : '';

  for (const floor of dto.floors) {
    for (let index = 1; index <= floor.unitsOnFloor; index += 1) {
      const base =
        floor.floor >= 0
          ? String(floor.floor * 100 + index)
          : `B${Math.abs(floor.floor)}-${String(index).padStart(2, '0')}`;

      const label = `${prefix}${base}`;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      planned.push({
        label,
        floor: floor.floor,
        kind: floor.kind ?? dto.defaultKind ?? 'RESIDENTIAL',
        areaSqm: floor.areaSqm,
      });
    }
  }

  return planned;
}

type UnitRow = Prisma.UnitGetPayload<Prisma.UnitDefaultArgs>;

/**
 * Maps a unit row onto the API response.
 *
 * Decimal columns are converted with Number() at this boundary only: Prisma
 * returns decimal.js instances, which serialize to `{ s, e, d }` in JSON and
 * would reach the client as an unusable object rather than 120.5.
 */
function toUnitResponse(unit: UnitRow): UnitResponse {
  return {
    id: unit.id,
    buildingId: unit.buildingId,
    label: unit.label,
    kind: unit.kind,
    status: unit.status,
    floor: unit.floor,
    block: unit.block,
    areaSqm: unit.areaSqm != null ? Number(unit.areaSqm) : null,
    bedroomCount: unit.bedroomCount,
    shareRatio: unit.shareRatio != null ? Number(unit.shareRatio) : null,
    parkingSpots: unit.parkingSpots,
    storageUnits: unit.storageUnits,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
  };
}
