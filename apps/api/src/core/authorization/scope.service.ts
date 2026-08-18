import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  resolveEffectivePermissions,
  type BuildingRoleName,
  type OrganizationRoleName,
  type RequestScope,
} from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { PrismaService } from '../database/prisma.service';

/**
 * Builds the server-side authorization scope for a request.
 *
 * THIS IS THE SINGLE ENTRY POINT for answering "what is this caller allowed to
 * touch". It exists because BM-00 rule 8 forbids trusting a client-supplied
 * BuildingId: the caller names a building in the URL, and this service proves —
 * against the database, on every request — that they hold a live membership for
 * it. If they do not, the request dies here with 403 and never reaches a
 * service that could leak another tenant's rows.
 *
 * Deliberate design choices:
 *   - The access token carries NO roles or building claims. Roles change (a
 *     term ends, a manager is removed) and a token minted 10 minutes ago would
 *     otherwise still carry authority that no longer exists.
 *   - Membership status and management-term validity are evaluated as of NOW,
 *     so an expired term stops granting manager rights without a cleanup job.
 */
@Injectable()
export class ScopeService {
  private readonly logger = new Logger(ScopeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves scope for a BUILDING-scoped request.
   *
   * @param userId     authenticated user id, taken from the verified JWT only
   * @param buildingId building id from the route — UNTRUSTED until this returns
   * @throws ForbiddenException when the caller has no live access to it
   */
  async resolveForBuilding(
    userId: string,
    buildingId: string,
  ): Promise<RequestScope> {
    const now = new Date();

    const person = await this.prisma.person.findUnique({
      where: { userId },
      select: { id: true },
    });

    // Load the building first so we know its owning organization. Note we do
    // NOT take the organization from the request — the building row is the
    // authority on which org it belongs to.
    const building = await this.prisma.building.findFirst({
      where: { id: buildingId, archivedAt: null },
      select: { id: true, organizationId: true },
    });

    // Same error for "does not exist" and "not yours" on purpose: a 404 here
    // would let an attacker enumerate which building ids are real. The Persian
    // wording preserves that ambiguity — it must never be split into
    // "ساختمان یافت نشد" vs "دسترسی ندارید".
    if (!building || !person) {
      throw new ForbiddenException(ERRORS.buildingNotAccessible);
    }

    const [orgMemberships, buildingMemberships, unitMemberships, activeTerm] =
      await Promise.all([
        this.prisma.organizationMembership.findMany({
          where: {
            organizationId: building.organizationId,
            personId: person.id,
            status: 'ACTIVE',
            OR: [{ endedAt: null }, { endedAt: { gt: now } }],
          },
          select: { role: true },
        }),
        this.prisma.buildingMembership.findMany({
          where: {
            buildingId: building.id,
            personId: person.id,
            status: 'ACTIVE',
            OR: [{ endedAt: null }, { endedAt: { gt: now } }],
          },
          select: {
            role: true,
            extraPermissions: true,
            revokedPermissions: true,
            managementTermId: true,
            managementTerm: {
              select: { status: true, startsAt: true, endsAt: true },
            },
          },
        }),
        this.prisma.unitMembership.findMany({
          where: {
            buildingId: building.id,
            personId: person.id,
            status: 'ACTIVE',
            OR: [{ endedAt: null }, { endedAt: { gt: now } }],
          },
          select: { unitId: true },
        }),
        this.prisma.managementTerm.findFirst({
          where: {
            buildingId: building.id,
            status: 'ACTIVE',
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
          select: { id: true, managerPersonId: true },
        }),
      ]);

    // A membership tied to a management term only grants authority while that
    // term is actually in force (BM-00 rule 1). This is what makes a manager
    // temporary WITHOUT a nightly job to revoke stale roles.
    const liveBuildingMemberships = buildingMemberships.filter((membership) => {
      if (!membership.managementTermId) return true;
      const term = membership.managementTerm;
      if (!term) return false;
      if (term.status !== 'ACTIVE') return false;
      if (term.startsAt > now) return false;
      if (term.endsAt && term.endsAt <= now) return false;
      return true;
    });

    const organizationRoles = orgMemberships.map(
      (m) => m.role as OrganizationRoleName,
    );
    const buildingRoles = liveBuildingMemberships.map(
      (m) => m.role as BuildingRoleName,
    );

    // No membership at either tier => no access. An org-level role is enough
    // (a portfolio admin need not be a member of every building), a
    // building-level role is enough, but SOMETHING must exist.
    if (organizationRoles.length === 0 && buildingRoles.length === 0) {
      // Log lines stay English: they are read by operators in dashboards and
      // alerting tools, never rendered in the UI. Only the thrown message —
      // the part the user actually sees — is Persian.
      this.logger.warn(
        `Denied building scope: user=${userId} building=${buildingId} (no live membership)`,
      );
      throw new ForbiddenException(ERRORS.buildingNotAccessible);
    }

    const permissions = resolveEffectivePermissions({
      organizationRoles,
      buildingRoles,
      extraPermissions: liveBuildingMemberships.flatMap(
        (m) => m.extraPermissions,
      ),
      revokedPermissions: liveBuildingMemberships.flatMap(
        (m) => m.revokedPermissions,
      ),
    });

    return {
      userId,
      personId: person.id,
      organizationId: building.organizationId,
      buildingId: building.id,
      organizationRoles,
      buildingRoles,
      unitIds: unitMemberships.map((m) => m.unitId),
      activeManagementTermId: activeTerm?.id ?? null,
      isActiveManager: activeTerm?.managerPersonId === person.id,
      permissions,
    };
  }

  /**
   * Resolves scope for an ORGANIZATION-scoped request (no building in play).
   * `buildingId` on the returned scope is null, which ScopedPrisma treats as
   * "org-wide query allowed, building filter omitted".
   */
  async resolveForOrganization(
    userId: string,
    organizationId: string,
  ): Promise<RequestScope> {
    const now = new Date();

    const person = await this.prisma.person.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!person)
      throw new ForbiddenException(ERRORS.organizationNotAccessible);

    const orgMemberships = await this.prisma.organizationMembership.findMany({
      where: {
        organizationId,
        personId: person.id,
        status: 'ACTIVE',
        OR: [{ endedAt: null }, { endedAt: { gt: now } }],
      },
      select: { role: true },
    });

    if (orgMemberships.length === 0) {
      this.logger.warn(
        `Denied org scope: user=${userId} org=${organizationId} (no live membership)`,
      );
      throw new ForbiddenException(ERRORS.organizationNotAccessible);
    }

    const organizationRoles = orgMemberships.map(
      (m) => m.role as OrganizationRoleName,
    );

    return {
      userId,
      personId: person.id,
      organizationId,
      buildingId: null,
      organizationRoles,
      buildingRoles: [],
      unitIds: [],
      activeManagementTermId: null,
      isActiveManager: false,
      permissions: resolveEffectivePermissions({
        organizationRoles,
        buildingRoles: [],
      }),
    };
  }
}
