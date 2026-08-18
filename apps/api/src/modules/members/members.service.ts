import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS, type RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantScopedRepository } from '../../core/database/tenant-scoped.repository';
// Masking lives in core/privacy so every endpoint that returns a person shares
// ONE implementation — see the file header for why a per-module copy is a leak
// waiting to happen.
import { toPersonSummary } from '../../core/privacy/contact-privacy';
import type { RequestContext } from '../auth/auth.service';
import type {
  BuildingMemberResponse,
  EndMembershipDto,
  OrganizationMemberResponse,
  UpdateBuildingMembershipDto,
  UpdateOrganizationMembershipDto,
} from './dto/member.dto';

/**
 * Membership administration — who holds which role, and for how long
 * (BM-01 §33, BM-00 rule 8).
 *
 * Extends TenantScopedRepository so every building-scoped query spreads
 * `tenantWhere(scope)`. That is the second isolation layer: even if a future
 * route forgot @ScopedTo, the query itself still cannot span buildings.
 *
 * FOUR RULES THIS SERVICE EXISTS TO ENFORCE:
 *
 *  1. REMOVING SOMEONE IS CLOSING A ROW, NEVER DELETING ONE. `end` sets
 *     status=ENDED and stamps `endedAt`; the row survives forever (R2). This
 *     matters beyond tidiness: a charge raised last March must stay attributable
 *     to whoever held the role that month, and a deleted membership makes that
 *     history unreadable.
 *
 *  2. NOBODY MAY GRANT AUTHORITY THEY DO NOT HOLD. Promoting someone to
 *     ORG_OWNER requires being ORG_OWNER. Without that check, an ORG_ADMIN
 *     could promote a confederate and inherit — via that account — the
 *     BUILDING_ARCHIVE permission the matrix deliberately withholds from them.
 *
 *  3. THE LAST ORG_OWNER CANNOT BE REMOVED OR DEMOTED. ScopeService resolves
 *     authority exclusively from membership rows, with no "founder" fallback,
 *     so removing the final owner produces an organization that literally
 *     nobody on earth can administer — unrecoverable without database surgery.
 *
 *  4. CONTACT DETAILS ARE MASKED UNLESS PERSON_READ_CONTACT IS HELD
 *     (BM-00 rule 6). A resident directory that hands every member a full
 *     address book is a privacy breach, not a feature.
 */
@Injectable()
export class MembersService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  // -------------------------------------------------------------------------
  //  building tier
  // -------------------------------------------------------------------------

  /**
   * Members of the caller's building.
   *
   * Ended memberships are excluded by default but remain retrievable — they are
   * history, not noise, and §33 expects "who used to live here" to be
   * answerable.
   */
  async listBuildingMembers(
    scope: RequestScope,
    includeEnded: boolean,
  ): Promise<BuildingMemberResponse[]> {
    const canSeeContact = scope.permissions.has(PERMISSIONS.PERSON_READ_CONTACT);

    const memberships = await this.prisma.buildingMembership.findMany({
      where: {
        ...this.tenantWhere(scope),
        ...(includeEnded ? {} : { status: { not: 'ENDED' } }),
      },
      include: { person: true },
      orderBy: [{ status: 'asc' }, { startedAt: 'asc' }],
    });

    // Unit attachments are fetched in ONE query for the whole page rather than
    // per member: a 200-unit building would otherwise issue 200 round trips to
    // render one screen.
    const personIds = memberships.map((membership) => membership.personId);
    const unitMemberships = personIds.length
      ? await this.prisma.unitMembership.findMany({
          where: {
            ...this.tenantWhere(scope),
            personId: { in: personIds },
            status: 'ACTIVE',
          },
          select: { personId: true, unitId: true },
        })
      : [];

    const unitsByPerson = new Map<string, string[]>();
    for (const row of unitMemberships) {
      const existing = unitsByPerson.get(row.personId);
      if (existing) existing.push(row.unitId);
      else unitsByPerson.set(row.personId, [row.unitId]);
    }

    return memberships.map((membership) => ({
      id: membership.id,
      buildingId: membership.buildingId,
      person: toPersonSummary(membership.person, canSeeContact),
      role: membership.role,
      status: membership.status,
      managementTermId: membership.managementTermId,
      startedAt: membership.startedAt,
      endedAt: membership.endedAt,
      unitIds: unitsByPerson.get(membership.personId) ?? [],
    }));
  }

  /**
   * Changes a building membership's role or status.
   *
   * BUILDING_MANAGER is not assignable here on purpose: management authority
   * comes from an ACTIVE ManagementTerm (BM-00 rule 1), and handing it out as a
   * plain role would create a manager with no term — authority that no election
   * granted and no term expiry ever revokes.
   */
  async updateBuildingMembership(
    scope: RequestScope,
    membershipId: string,
    dto: UpdateBuildingMembershipDto,
    context: RequestContext,
  ): Promise<BuildingMemberResponse> {
    const before = await this.prisma.buildingMembership.findFirst({
      where: { id: membershipId, ...this.tenantWhere(scope) },
      include: { person: true },
    });
    // NotFound rather than Forbidden: a membership in another building must not
    // be confirmed to exist.
    if (!before) throw new NotFoundException(ERRORS.notFound);

    if (before.status === 'ENDED') {
      // Re-opening a closed membership would rewrite history. A returning
      // resident gets a NEW membership row via a fresh invitation.
      throw new ConflictException(ERRORS.conflict);
    }

    if (dto.role === 'BUILDING_MANAGER') {
      throw new ConflictException(ERRORS.termNotActive);
    }

    const data: Prisma.BuildingMembershipUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;

    if (Object.keys(data).length === 0) {
      return this.toBuildingMemberResponse(scope, before);
    }

    const updated = await this.prisma.buildingMembership.update({
      where: { id: before.id },
      data,
      include: { person: true },
    });

    await this.audit.log(scope, {
      action: 'member.building.role_updated',
      resourceType: 'BuildingMembership',
      resourceId: updated.id,
      before,
      after: updated,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.toBuildingMemberResponse(scope, updated);
  }

  /**
   * Ends a building membership — the platform's "remove member" (rule 1 above).
   *
   * Also closes the person's unit attachments in the same transaction: leaving
   * an ACTIVE UnitMembership behind would keep feeding `scope.unitIds` and let
   * a removed resident keep reading their old unit's data.
   */
  async endBuildingMembership(
    scope: RequestScope,
    membershipId: string,
    dto: EndMembershipDto,
    context: RequestContext,
  ): Promise<BuildingMemberResponse> {
    const before = await this.prisma.buildingMembership.findFirst({
      where: { id: membershipId, ...this.tenantWhere(scope) },
      include: { person: true },
    });
    if (!before) throw new NotFoundException(ERRORS.notFound);
    if (before.status === 'ENDED') {
      throw new ConflictException(ERRORS.conflict);
    }

    const buildingId = this.tenantWhere(scope).buildingId;
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const closed = await tx.buildingMembership.update({
        where: { id: before.id },
        data: { status: 'ENDED', endedAt: now },
        include: { person: true },
      });

      await tx.unitMembership.updateMany({
        where: {
          buildingId,
          personId: before.personId,
          status: 'ACTIVE',
        },
        data: { status: 'ENDED', endedAt: now },
      });

      // Transactional: access revocation that left no audit trace is precisely
      // what an investigation later needs and cannot reconstruct.
      await this.audit.logInTransaction(tx, scope, {
        action: 'member.building.ended',
        resourceType: 'BuildingMembership',
        resourceId: before.id,
        before,
        after: { ...closed, reason: dto.reason ?? null },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return closed;
    });

    return this.toBuildingMemberResponse(scope, updated);
  }

  // -------------------------------------------------------------------------
  //  organization tier
  // -------------------------------------------------------------------------

  /** Members of the caller's organization. */
  async listOrganizationMembers(
    scope: RequestScope,
    includeEnded: boolean,
  ): Promise<OrganizationMemberResponse[]> {
    const canSeeContact = scope.permissions.has(PERMISSIONS.PERSON_READ_CONTACT);

    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(includeEnded ? {} : { status: { not: 'ENDED' } }),
      },
      include: { person: true },
      orderBy: [{ status: 'asc' }, { startedAt: 'asc' }],
    });

    return memberships.map((membership) => ({
      id: membership.id,
      organizationId: membership.organizationId,
      person: toPersonSummary(membership.person, canSeeContact),
      role: membership.role,
      status: membership.status,
      startedAt: membership.startedAt,
      endedAt: membership.endedAt,
    }));
  }

  /**
   * Changes an organization membership's role or status.
   *
   * Enforces rules 2 and 3 from the class docblock: only an ORG_OWNER may
   * create another, and demoting the last one is refused.
   */
  async updateOrganizationMembership(
    scope: RequestScope,
    membershipId: string,
    dto: UpdateOrganizationMembershipDto,
    context: RequestContext,
  ): Promise<OrganizationMemberResponse> {
    const before = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId: scope.organizationId },
      include: { person: true },
    });
    if (!before) throw new NotFoundException(ERRORS.notFound);
    if (before.status === 'ENDED') {
      throw new ConflictException(ERRORS.conflict);
    }

    const isOwner = scope.organizationRoles.includes('ORG_OWNER');
    if (dto.role === 'ORG_OWNER' && !isOwner) {
      throw new ForbiddenException(ERRORS.forbidden);
    }

    // Demoting or suspending the final owner strands the organization — see
    // rule 3. Checked for BOTH transitions because either one removes the last
    // live ORG_OWNER from ScopeService's view.
    const losesOwnership =
      before.role === 'ORG_OWNER' &&
      ((dto.role !== undefined && dto.role !== 'ORG_OWNER') ||
        (dto.status !== undefined && dto.status !== 'ACTIVE'));

    if (losesOwnership) {
      await this.assertNotLastOrganizationOwner(
        scope.organizationId,
        before.id,
      );
    }

    const data: Prisma.OrganizationMembershipUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;

    if (Object.keys(data).length === 0) {
      return toOrganizationMemberResponse(
        before,
        scope.permissions.has(PERMISSIONS.PERSON_READ_CONTACT),
      );
    }

    const updated = await this.prisma.organizationMembership.update({
      where: { id: before.id },
      data,
      include: { person: true },
    });

    await this.audit.log(scope, {
      action: 'member.organization.role_updated',
      resourceType: 'OrganizationMembership',
      resourceId: updated.id,
      before,
      after: updated,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return toOrganizationMemberResponse(
      updated,
      scope.permissions.has(PERMISSIONS.PERSON_READ_CONTACT),
    );
  }

  /** Ends an organization membership. Refuses on the last live ORG_OWNER. */
  async endOrganizationMembership(
    scope: RequestScope,
    membershipId: string,
    dto: EndMembershipDto,
    context: RequestContext,
  ): Promise<OrganizationMemberResponse> {
    const before = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId: scope.organizationId },
      include: { person: true },
    });
    if (!before) throw new NotFoundException(ERRORS.notFound);
    if (before.status === 'ENDED') {
      throw new ConflictException(ERRORS.conflict);
    }

    if (before.role === 'ORG_OWNER') {
      await this.assertNotLastOrganizationOwner(
        scope.organizationId,
        before.id,
      );
    }

    const updated = await this.prisma.organizationMembership.update({
      where: { id: before.id },
      data: { status: 'ENDED', endedAt: new Date() },
      include: { person: true },
    });

    await this.audit.log(scope, {
      action: 'member.organization.ended',
      resourceType: 'OrganizationMembership',
      resourceId: updated.id,
      before,
      after: { ...updated, reason: dto.reason ?? null },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return toOrganizationMemberResponse(
      updated,
      scope.permissions.has(PERMISSIONS.PERSON_READ_CONTACT),
    );
  }

  // -------------------------------------------------------------------------
  //  internals
  // -------------------------------------------------------------------------

  /**
   * Refuses an operation that would leave the organization with no live owner.
   *
   * `excludingId` is the membership about to change, so it is not counted as
   * one of the survivors.
   */
  private async assertNotLastOrganizationOwner(
    organizationId: string,
    excludingId: string,
  ): Promise<void> {
    const now = new Date();
    const remaining = await this.prisma.organizationMembership.count({
      where: {
        organizationId,
        id: { not: excludingId },
        role: 'ORG_OWNER',
        status: 'ACTIVE',
        OR: [{ endedAt: null }, { endedAt: { gt: now } }],
      },
    });

    if (remaining === 0) {
      throw new ConflictException(ERRORS.cannotRemoveLastOrgOwner);
    }
  }

  /** Re-reads unit attachments for a single membership response. */
  private async toBuildingMemberResponse(
    scope: RequestScope,
    membership: BuildingMembershipWithPerson,
  ): Promise<BuildingMemberResponse> {
    const unitMemberships = await this.prisma.unitMembership.findMany({
      where: {
        ...this.tenantWhere(scope),
        personId: membership.personId,
        status: 'ACTIVE',
      },
      select: { unitId: true },
    });

    return {
      id: membership.id,
      buildingId: membership.buildingId,
      person: toPersonSummary(
        membership.person,
        scope.permissions.has(PERMISSIONS.PERSON_READ_CONTACT),
      ),
      role: membership.role,
      status: membership.status,
      managementTermId: membership.managementTermId,
      startedAt: membership.startedAt,
      endedAt: membership.endedAt,
      unitIds: unitMemberships.map((row) => row.unitId),
    };
  }
}

type BuildingMembershipWithPerson = Prisma.BuildingMembershipGetPayload<{
  include: { person: true };
}>;

type OrganizationMembershipWithPerson =
  Prisma.OrganizationMembershipGetPayload<{ include: { person: true } }>;

function toOrganizationMemberResponse(
  membership: OrganizationMembershipWithPerson,
  canSeeContact: boolean,
): OrganizationMemberResponse {
  return {
    id: membership.id,
    organizationId: membership.organizationId,
    person: toPersonSummary(membership.person, canSeeContact),
    role: membership.role,
    status: membership.status,
    startedAt: membership.startedAt,
    endedAt: membership.endedAt,
  };
}


