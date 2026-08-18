import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type LocationPrecision } from '@prisma/client';
import { PERMISSIONS, type RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import type { RequestContext } from '../auth/auth.service';
import type {
  BuildingAddressDto,
  BuildingAddressResponse,
  BuildingResponse,
  BuildingSettingsResponse,
  BuildingSummaryResponse,
  ChangeBuildingStatusDto,
  CreateBuildingDto,
  DuplicateBuildingCandidate,
  UpdateBuildingDto,
  UpdateBuildingSettingsDto,
} from './dto/building.dto';

/**
 * Buildings — the permanent operational root of the platform (BM-00 rule 1,
 * BM-01 §2, §7).
 *
 * THREE INVARIANTS THIS SERVICE EXISTS TO HOLD:
 *
 *  1. IDENTITY IS PERMANENT. There is no delete method, and no code path
 *     changes a building's id. Retiring one is a STATUS transition
 *     (ARCHIVED / DECOMMISSIONED) plus `archivedAt`; its units, ledger and
 *     governance history survive untouched. PrismaService additionally blocks
 *     hard deletes on Building at the client level, so even a future mistake
 *     cannot erase one.
 *
 *  2. LOCATION PRIVACY IS ENFORCED HERE, NOT IN THE UI. `applyLocationPrecision`
 *     strips coordinates from the response based on the address's precision
 *     ceiling AND the caller's permissions. §12 states this explicitly: "the
 *     backend must enforce this — do not rely only on frontend hiding".
 *
 *  3. DUPLICATE BUILDINGS ARE WARNED ABOUT, NEVER MERGED. §35 asks for a
 *     warning and forbids automatic merging, so a suspected duplicate returns
 *     409 with the candidates and the caller must explicitly confirm.
 *
 * Every method except `create` takes a proven RequestScope. `create` is
 * organization-scoped: the guard has already verified org membership, so the
 * organization the building lands in comes from the scope, never the body.
 */
@Injectable()
export class BuildingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates a building with its address and settings row (BM-01 §32 step 3).
   *
   * All three rows are written in ONE transaction. BuildingSettings in
   * particular is created eagerly and never lazily: the schema models it as a
   * required 1:1, and every later module (charge cycle in BM-03, notification
   * preferences in BM-07) would otherwise need a "settings not configured yet"
   * branch that could silently pick different defaults than the schema.
   */
  async create(
    scope: RequestScope,
    dto: CreateBuildingDto,
    context: RequestContext,
  ): Promise<BuildingResponse> {
    const organization = await this.prisma.organization.findFirst({
      where: { id: scope.organizationId, archivedAt: null },
      select: {
        id: true,
        defaultCurrency: true,
        defaultTimeZone: true,
        defaultLocale: true,
      },
    });
    if (!organization) throw new NotFoundException(ERRORS.notFound);

    // §35: warn before creating something that looks like an existing building.
    if (!dto.confirmPossibleDuplicate) {
      const candidates = await this.findDuplicateCandidates(
        organization.id,
        dto,
      );
      if (candidates.length > 0) {
        // 409 with the evidence attached, so the client can show WHICH building
        // it resembles rather than a bare "already exists".
        throw new ConflictException({
          statusCode: 409,
          message: ERRORS.duplicateBuildingSuspected,
          duplicates: candidates,
        });
      }
    }

    const code = dto.code ?? (await this.generateBuildingCode(organization.id));

    const created = await this.prisma
      .$transaction(async (tx) => {
        const address = await tx.address.create({
          data: {
            organizationId: organization.id,
            countryCode: dto.address.countryCode ?? 'IR',
            province: dto.address.province ?? null,
            city: dto.address.city,
            district: dto.address.district ?? null,
            line1: dto.address.line1,
            line2: dto.address.line2 ?? null,
            postalCode: dto.address.postalCode ?? null,
            plaqueNumber: dto.address.plaqueNumber ?? null,
            latitude: dto.address.latitude ?? null,
            longitude: dto.address.longitude ?? null,
            geoCell: geoCellOf(dto.address.latitude, dto.address.longitude),
            ...(dto.address.locationPrecision
              ? { locationPrecision: dto.address.locationPrecision }
              : {}),
            locationProvider:
              dto.address.latitude != null ? 'manual' : null,
            locationUpdatedAt:
              dto.address.latitude != null ? new Date() : null,
          },
        });

        const building = await tx.building.create({
          data: {
            organizationId: organization.id,
            addressId: address.id,
            name: dto.name,
            code,
            // §32 requires drafts to be supported, but a building created
            // through this endpoint already has a name and address, so ACTIVE
            // is the honest default. DRAFT is reachable via the status endpoint.
            status: 'ACTIVE',
            floorCount: dto.floorCount ?? null,
            basementCount: dto.basementCount ?? null,
            totalUnitCount: dto.totalUnitCount ?? null,
            constructionYear: dto.constructionYear ?? null,
            totalAreaSqm: dto.totalAreaSqm ?? null,
            hasElevator: dto.hasElevator ?? false,
            elevatorCount: dto.elevatorCount ?? 0,
            hasParking: dto.hasParking ?? false,
            hasCentralHeating: dto.hasCentralHeating ?? false,
            // Inherit the organization's defaults rather than hard-coding IRR /
            // Asia/Tehran here — BM-01 §29 forbids baking currency into logic.
            currency: dto.currency ?? organization.defaultCurrency,
            timeZone: dto.timeZone ?? organization.defaultTimeZone,
            locale: dto.locale ?? organization.defaultLocale,
            settings: { create: {} },
          },
          include: {
            address: true,
            settings: true,
            _count: { select: { units: { where: { archivedAt: null } } } },
          },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'building.created',
          resourceType: 'Building',
          resourceId: building.id,
          after: building,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return building;
      })
      .catch((error: unknown) => {
        // Unique (organizationId, code). Reachable when two managers create a
        // building concurrently, or when a caller supplies a code already used.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(ERRORS.buildingCodeTaken);
        }
        throw error;
      });

    return this.toBuildingResponse(created, created._count.units, scope);
  }

  /**
   * Buildings in the caller's organization that they may actually see.
   *
   * An org-level role sees the whole portfolio; someone with only
   * building-level memberships sees exactly those buildings. That distinction
   * is BM-01 §5 rule 5 — "organization membership does not automatically grant
   * access to every building" — read in the safe direction.
   */
  async listForScope(scope: RequestScope): Promise<BuildingSummaryResponse[]> {
    const hasOrgWideAccess = scope.organizationRoles.length > 0;

    let accessibleIds: string[] | null = null;
    if (!hasOrgWideAccess) {
      if (!scope.personId) return [];
      const now = new Date();
      const memberships = await this.prisma.buildingMembership.findMany({
        where: {
          personId: scope.personId,
          status: 'ACTIVE',
          OR: [{ endedAt: null }, { endedAt: { gt: now } }],
          building: { organizationId: scope.organizationId },
        },
        select: { buildingId: true },
      });
      accessibleIds = [...new Set(memberships.map((m) => m.buildingId))];
      if (accessibleIds.length === 0) return [];
    }

    const buildings = await this.prisma.building.findMany({
      where: {
        organizationId: scope.organizationId,
        archivedAt: null,
        ...(accessibleIds ? { id: { in: accessibleIds } } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        code: true,
        name: true,
        status: true,
        address: { select: { city: true } },
        _count: { select: { units: { where: { archivedAt: null } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return buildings.map((building) => ({
      id: building.id,
      organizationId: building.organizationId,
      code: building.code,
      name: building.name,
      status: building.status,
      city: building.address?.city ?? null,
      unitCount: building._count.units,
    }));
  }

  /** One building, with coordinates filtered to what the caller may see. */
  async findOne(scope: RequestScope): Promise<BuildingResponse> {
    const building = await this.loadScopedBuilding(scope);
    return this.toBuildingResponse(building, building._count.units, scope);
  }

  /**
   * Updates the building profile and, when supplied, its address.
   *
   * Refuses on ARCHIVED / DECOMMISSIONED buildings: those are historical states
   * (§8) and editing one would rewrite the record a past manager is accountable
   * for — exactly what BM-00 rule 19 forbids.
   */
  async update(
    scope: RequestScope,
    dto: UpdateBuildingDto,
    context: RequestContext,
  ): Promise<BuildingResponse> {
    const before = await this.loadScopedBuilding(scope);
    this.assertMutable(before.status);

    const data: Prisma.BuildingUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.floorCount !== undefined) data.floorCount = dto.floorCount;
    if (dto.basementCount !== undefined) data.basementCount = dto.basementCount;
    if (dto.totalUnitCount !== undefined) {
      data.totalUnitCount = dto.totalUnitCount;
    }
    if (dto.constructionYear !== undefined) {
      data.constructionYear = dto.constructionYear;
    }
    if (dto.totalAreaSqm !== undefined) data.totalAreaSqm = dto.totalAreaSqm;
    if (dto.hasElevator !== undefined) data.hasElevator = dto.hasElevator;
    if (dto.elevatorCount !== undefined) data.elevatorCount = dto.elevatorCount;
    if (dto.hasParking !== undefined) data.hasParking = dto.hasParking;
    if (dto.hasCentralHeating !== undefined) {
      data.hasCentralHeating = dto.hasCentralHeating;
    }
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.timeZone !== undefined) data.timeZone = dto.timeZone;
    if (dto.locale !== undefined) data.locale = dto.locale;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.address) {
        await this.upsertAddress(tx, before, dto.address);
      }

      const next =
        Object.keys(data).length > 0
          ? await tx.building.update({
              where: { id: before.id },
              data,
              include: BUILDING_INCLUDE,
            })
          : await tx.building.findUniqueOrThrow({
              where: { id: before.id },
              include: BUILDING_INCLUDE,
            });

      await this.audit.logInTransaction(tx, scope, {
        action: 'building.updated',
        resourceType: 'Building',
        resourceId: before.id,
        before,
        after: next,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return next;
    });

    return this.toBuildingResponse(updated, updated._count.units, scope);
  }

  /**
   * Moves the building through its lifecycle (§8).
   *
   * ARCHIVING IS NOT DELETION. `archivedAt` hides the building from active
   * listings; every unit, ledger entry and governance record remains queryable
   * by id. Reactivating simply clears the timestamp, which is why this is a
   * status transition rather than a destructive operation.
   */
  async changeStatus(
    scope: RequestScope,
    dto: ChangeBuildingStatusDto,
    context: RequestContext,
  ): Promise<BuildingResponse> {
    const before = await this.loadScopedBuilding(scope);

    if (before.status === dto.status) {
      return this.toBuildingResponse(before, before._count.units, scope);
    }

    const archiving =
      dto.status === 'ARCHIVED' || dto.status === 'DECOMMISSIONED';

    const updated = await this.prisma.building.update({
      where: { id: before.id },
      data: {
        status: dto.status,
        archivedAt: archiving ? (before.archivedAt ?? new Date()) : null,
      },
      include: BUILDING_INCLUDE,
    });

    await this.audit.log(scope, {
      action: `building.status.${dto.status.toLowerCase()}`,
      resourceType: 'Building',
      resourceId: before.id,
      before: { status: before.status, archivedAt: before.archivedAt },
      after: {
        status: updated.status,
        archivedAt: updated.archivedAt,
        reason: dto.reason ?? null,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.toBuildingResponse(updated, updated._count.units, scope);
  }

  /** Operational settings for the building (§27). */
  async getSettings(scope: RequestScope): Promise<BuildingSettingsResponse> {
    const building = await this.loadScopedBuilding(scope);
    if (!building.settings) {
      // The 1:1 row is created with the building, so this means data drift.
      throw new NotFoundException(ERRORS.notFound);
    }
    return toSettingsResponse(building.settings);
  }

  async updateSettings(
    scope: RequestScope,
    dto: UpdateBuildingSettingsDto,
    context: RequestContext,
  ): Promise<BuildingSettingsResponse> {
    const building = await this.loadScopedBuilding(scope);
    this.assertMutable(building.status);

    const before = building.settings;
    if (!before) throw new NotFoundException(ERRORS.notFound);

    const data: Prisma.BuildingSettingsUpdateInput = {};
    if (dto.chargeCycle !== undefined) data.chargeCycle = dto.chargeCycle;
    if (dto.chargeDueDay !== undefined) data.chargeDueDay = dto.chargeDueDay;
    if (dto.notifyByEmail !== undefined) data.notifyByEmail = dto.notifyByEmail;
    if (dto.notifyBySms !== undefined) data.notifyBySms = dto.notifyBySms;
    if (dto.notifyInApp !== undefined) data.notifyInApp = dto.notifyInApp;
    if (dto.showResidentContacts !== undefined) {
      data.showResidentContacts = dto.showResidentContacts;
    }
    if (dto.showUnitOwners !== undefined) {
      data.showUnitOwners = dto.showUnitOwners;
    }
    if (dto.discoverableByProviders !== undefined) {
      data.discoverableByProviders = dto.discoverableByProviders;
    }

    if (Object.keys(data).length === 0) return toSettingsResponse(before);

    const updated = await this.prisma.buildingSettings.update({
      where: { buildingId: building.id },
      data,
    });

    // Privacy-affecting settings deserve their own trail (BM-01 §38 lists
    // "privacy-sensitive access" among the mandatory audit events).
    await this.audit.log(scope, {
      action: 'building.settings.updated',
      resourceType: 'BuildingSettings',
      resourceId: building.id,
      before,
      after: updated,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return toSettingsResponse(updated);
  }

  // -------------------------------------------------------------------------
  //  internals
  // -------------------------------------------------------------------------

  /**
   * Loads the building named by the PROVEN scope.
   *
   * Note the id comes from `scope.buildingId`, which BuildingScopeGuard
   * resolved and verified — not from a method argument. That is what makes an
   * IDOR here structurally impossible rather than merely unlikely.
   */
  private async loadScopedBuilding(scope: RequestScope) {
    if (!scope.buildingId) {
      throw new NotFoundException(ERRORS.notFound);
    }
    const building = await this.prisma.building.findUnique({
      where: { id: scope.buildingId },
      include: BUILDING_INCLUDE,
    });
    if (!building) throw new NotFoundException(ERRORS.notFound);
    return building;
  }

  /** Historical states are read-only (§8, BM-00 rule 19). */
  private assertMutable(status: string): void {
    if (status === 'ARCHIVED' || status === 'DECOMMISSIONED') {
      throw new ConflictException(ERRORS.buildingNotEditableInStatus);
    }
  }

  /**
   * Creates or updates the building's address row.
   *
   * Updates in place rather than creating a new row: Address is referenced by
   * the building and, later, by work orders and documents, so replacing it
   * would orphan those references.
   */
  private async upsertAddress(
    tx: Prisma.TransactionClient,
    building: { id: string; organizationId: string; addressId: string | null },
    dto: BuildingAddressDto,
  ): Promise<void> {
    const hasCoordinates = dto.latitude != null && dto.longitude != null;

    if (!building.addressId) {
      const address = await tx.address.create({
        data: {
          organizationId: building.organizationId,
          countryCode: dto.countryCode ?? 'IR',
          province: dto.province ?? null,
          city: dto.city,
          district: dto.district ?? null,
          line1: dto.line1,
          line2: dto.line2 ?? null,
          postalCode: dto.postalCode ?? null,
          plaqueNumber: dto.plaqueNumber ?? null,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          geoCell: geoCellOf(dto.latitude, dto.longitude),
          ...(dto.locationPrecision
            ? { locationPrecision: dto.locationPrecision }
            : {}),
          locationProvider: hasCoordinates ? 'manual' : null,
          locationUpdatedAt: hasCoordinates ? new Date() : null,
        },
      });
      await tx.building.update({
        where: { id: building.id },
        data: { addressId: address.id },
      });
      return;
    }

    await tx.address.update({
      where: { id: building.addressId },
      data: {
        ...(dto.countryCode !== undefined
          ? { countryCode: dto.countryCode }
          : {}),
        ...(dto.province !== undefined ? { province: dto.province } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.district !== undefined ? { district: dto.district } : {}),
        ...(dto.line1 !== undefined ? { line1: dto.line1 } : {}),
        ...(dto.line2 !== undefined ? { line2: dto.line2 } : {}),
        ...(dto.postalCode !== undefined
          ? { postalCode: dto.postalCode }
          : {}),
        ...(dto.plaqueNumber !== undefined
          ? { plaqueNumber: dto.plaqueNumber }
          : {}),
        ...(dto.locationPrecision !== undefined
          ? { locationPrecision: dto.locationPrecision }
          : {}),
        ...(hasCoordinates
          ? {
              latitude: dto.latitude,
              longitude: dto.longitude,
              geoCell: geoCellOf(dto.latitude, dto.longitude),
              locationProvider: 'manual',
              locationUpdatedAt: new Date(),
            }
          : {}),
      },
    });
  }

  /**
   * Finds existing buildings that look like the one being created (§35).
   *
   * Signals, strongest first:
   *   - identical postal code (in Iran this identifies a specific entrance);
   *   - coordinates within roughly 40 m;
   *   - same city AND a normalised street line that matches.
   *
   * Scoped to the caller's own organization on purpose: telling one management
   * company that a rival already registered an address would leak portfolio
   * information across tenants.
   */
  private async findDuplicateCandidates(
    organizationId: string,
    dto: CreateBuildingDto,
  ): Promise<DuplicateBuildingCandidate[]> {
    const { postalCode, latitude, longitude, city, line1 } = dto.address;

    const candidates = await this.prisma.building.findMany({
      where: {
        organizationId,
        archivedAt: null,
        address: {
          is: {
            OR: [
              ...(postalCode ? [{ postalCode }] : []),
              ...(latitude != null && longitude != null
                ? [
                    {
                      latitude: {
                        gte: new Prisma.Decimal(latitude - COORD_EPSILON),
                        lte: new Prisma.Decimal(latitude + COORD_EPSILON),
                      },
                      longitude: {
                        gte: new Prisma.Decimal(longitude - COORD_EPSILON),
                        lte: new Prisma.Decimal(longitude + COORD_EPSILON),
                      },
                    },
                  ]
                : []),
              { city },
            ],
          },
        },
      },
      select: {
        id: true,
        name: true,
        code: true,
        address: {
          select: {
            city: true,
            line1: true,
            postalCode: true,
            latitude: true,
            longitude: true,
          },
        },
      },
      take: 20,
    });

    const normalizedLine = normalizeAddressLine(line1);

    return candidates
      .map((candidate) => {
        const address = candidate.address;
        const matchedOn: string[] = [];

        if (postalCode && address?.postalCode === postalCode) {
          matchedOn.push('postalCode');
        }
        if (
          latitude != null &&
          longitude != null &&
          address?.latitude != null &&
          address?.longitude != null &&
          Math.abs(Number(address.latitude) - latitude) <= COORD_EPSILON &&
          Math.abs(Number(address.longitude) - longitude) <= COORD_EPSILON
        ) {
          matchedOn.push('coordinates');
        }
        if (
          address?.city === city &&
          normalizeAddressLine(address.line1) === normalizedLine
        ) {
          matchedOn.push('address');
        }

        return {
          id: candidate.id,
          name: candidate.name,
          code: candidate.code,
          city: address?.city ?? null,
          line1: address?.line1 ?? null,
          postalCode: address?.postalCode ?? null,
          matchedOn,
        };
      })
      // A shared city alone is not a duplicate signal — it would flag every
      // building in Tehran. Only rows that matched a real signal survive.
      .filter((candidate) => candidate.matchedOn.length > 0);
  }

  /**
   * Generates the next `BLD-000123` code for an organization (§37).
   *
   * Derived from the current count, and the unique index on
   * (organizationId, code) is what actually guarantees uniqueness: two
   * concurrent creations can compute the same number, and the loser gets a
   * P2002 that surfaces as `buildingCodeTaken` rather than a duplicate row.
   */
  private async generateBuildingCode(organizationId: string): Promise<string> {
    const existing = await this.prisma.building.count({
      where: { organizationId },
    });
    return `BLD-${String(existing + 1).padStart(6, '0')}`;
  }

  /**
   * Maps a building row onto the API response, applying location privacy.
   */
  private toBuildingResponse(
    building: BuildingWithRelations,
    unitCount: number,
    scope: RequestScope,
  ): BuildingResponse {
    return {
      id: building.id,
      organizationId: building.organizationId,
      code: building.code,
      name: building.name,
      status: building.status,
      floorCount: building.floorCount,
      basementCount: building.basementCount,
      totalUnitCount: building.totalUnitCount,
      constructionYear: building.constructionYear,
      totalAreaSqm:
        building.totalAreaSqm != null ? Number(building.totalAreaSqm) : null,
      hasElevator: building.hasElevator,
      elevatorCount: building.elevatorCount,
      hasParking: building.hasParking,
      hasCentralHeating: building.hasCentralHeating,
      currency: building.currency,
      timeZone: building.timeZone,
      locale: building.locale,
      address: building.address
        ? this.applyLocationPrecision(building.address, scope)
        : null,
      settings: building.settings ? toSettingsResponse(building.settings) : null,
      unitCount,
      createdAt: building.createdAt,
      updatedAt: building.updatedAt,
    };
  }

  /**
   * Decides how much of a building's location the caller may see
   * (BM-01 §11, §12; BM-00 rule 6).
   *
   * The address's `locationPrecision` is a CEILING, not a floor — a building
   * marked EXACT still hides coordinates from a caller who lacks
   * BUILDING_UPDATE, and one marked HIDDEN reveals nothing to anyone below the
   * organization tier. The coordinates are removed from the payload entirely
   * rather than blurred, so there is no rounded value to triangulate from.
   */
  private applyLocationPrecision(
    address: NonNullable<BuildingWithRelations['address']>,
    scope: RequestScope,
  ): BuildingAddressResponse {
    const base = {
      id: address.id,
      countryCode: address.countryCode,
      province: address.province,
      city: address.city,
      district: address.district,
      line1: address.line1,
      line2: address.line2,
      postalCode: address.postalCode,
      plaqueNumber: address.plaqueNumber,
      locationPrecision: address.locationPrecision as LocationPrecision,
    };

    const withoutCoordinates: BuildingAddressResponse = {
      ...base,
      latitude: null,
      longitude: null,
    };

    if (address.latitude == null || address.longitude == null) {
      return withoutCoordinates;
    }
    if (address.locationPrecision === 'HIDDEN') return withoutCoordinates;

    // Managers and org-tier roles may see the pin; a resident sees the street
    // address they already know but never the machine-readable coordinates.
    const maySeeExact =
      scope.permissions.has(PERMISSIONS.BUILDING_UPDATE) ||
      scope.organizationRoles.length > 0;

    if (address.locationPrecision === 'EXACT' && maySeeExact) {
      return {
        ...base,
        latitude: Number(address.latitude),
        longitude: Number(address.longitude),
      };
    }

    return withoutCoordinates;
  }
}

/** Roughly 40 m at Iranian latitudes — close enough to be the same entrance. */
const COORD_EPSILON = 0.0004;

const BUILDING_INCLUDE = {
  address: true,
  settings: true,
  _count: { select: { units: { where: { archivedAt: null } } } },
} satisfies Prisma.BuildingInclude;

type BuildingWithRelations = Prisma.BuildingGetPayload<{
  include: typeof BUILDING_INCLUDE;
}>;

function toSettingsResponse(settings: {
  chargeCycle: BuildingSettingsResponse['chargeCycle'];
  chargeDueDay: number;
  notifyByEmail: boolean;
  notifyBySms: boolean;
  notifyInApp: boolean;
  showResidentContacts: boolean;
  showUnitOwners: boolean;
  discoverableByProviders: boolean;
}): BuildingSettingsResponse {
  return {
    chargeCycle: settings.chargeCycle,
    chargeDueDay: settings.chargeDueDay,
    notifyByEmail: settings.notifyByEmail,
    notifyBySms: settings.notifyBySms,
    notifyInApp: settings.notifyInApp,
    showResidentContacts: settings.showResidentContacts,
    showUnitOwners: settings.showUnitOwners,
    discoverableByProviders: settings.discoverableByProviders,
  };
}

/**
 * Coarse geohash-style cell used for privacy-preserving proximity search
 * (BM-05). Two decimal places is roughly a 1 km square — enough to answer "is
 * there a building near this provider" without revealing which one.
 */
function geoCellOf(
  latitude: number | undefined,
  longitude: number | undefined,
): string | null {
  if (latitude == null || longitude == null) return null;
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

/**
 * Normalises a Persian street line for duplicate comparison.
 *
 * Persian text has several traps that make two identical addresses compare
 * unequal: the Arabic ي/ك versus the Persian ی/ک, the zero-width non-joiner,
 * Persian digits, and inconsistent spacing. Without this, "خیابان ولی‌عصر" and
 * "خيابان ولي عصر" are different strings and the duplicate check silently never
 * fires.
 */
function normalizeAddressLine(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/\u200c/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u06F0-\u06F9]/g, (d) =>
      String(d.charCodeAt(0) - 0x06f0),
    )
    .replace(/[\u0660-\u0669]/g, (d) =>
      String(d.charCodeAt(0) - 0x0660),
    )
    .replace(/[.,،\-_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
