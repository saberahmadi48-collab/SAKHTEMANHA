import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import type { RequestContext } from '../auth/auth.service';
import type {
  CreateOrganizationDto,
  OrganizationResponse,
  OrganizationSummaryResponse,
  UpdateOrganizationDto,
} from './dto/organization.dto';

/**
 * Organizations — the tenant root and step 2 of BM-01 §32 onboarding
 * ("create account → create/join organization → create building").
 *
 * THE ONE THING THAT MAKES THIS MODULE CORRECT:
 * creating an organization and minting the creator's ORG_OWNER membership
 * happen in a SINGLE transaction. If they were two statements, a failure
 * between them leaves an organization nobody on earth can administer — not even
 * the person who just created it, because ScopeService resolves authority
 * exclusively from membership rows. There is deliberately no "the creator is
 * implicitly the owner" fallback anywhere in the authorization path; the row IS
 * the authority, so the row must exist or nothing must.
 *
 * Note what is NOT here: no method takes an organizationId the caller supplied
 * without BuildingScopeGuard having proved it first. `create` is the sole
 * exception, and it is the one operation that legitimately has no prior scope —
 * which is exactly why it grants the caller their own access rather than
 * accepting any.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates an organization and makes the caller its ORG_OWNER.
   *
   * Unscoped by necessity — a brand-new account belongs to no tenant yet, so
   * there is no scope to check. What protects it: the caller must be
   * authenticated, must already have a Person record, and receives authority
   * over the organization they just created and nothing else.
   */
  async create(
    userId: string,
    dto: CreateOrganizationDto,
    context: RequestContext,
  ): Promise<OrganizationResponse> {
    const person = await this.prisma.person.findUnique({
      where: { userId },
      select: { id: true },
    });

    // A User with no Person cannot hold a membership, so it could not be given
    // ownership of what it is about to create. Registration always creates the
    // pair, so this is a data-integrity guard rather than a routine path.
    if (!person) {
      throw new ForbiddenException(ERRORS.personProfileRequired);
    }

    const organization = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.organization.create({
          data: {
            slug: dto.slug,
            name: dto.name,
            type: dto.type ?? 'INDIVIDUAL',
            legalName: dto.legalName ?? null,
            taxIdentifier: dto.taxIdentifier ?? null,
            contactEmail: dto.contactEmail ?? null,
            contactPhone: dto.contactPhone ?? null,
            ...(dto.defaultLocale ? { defaultLocale: dto.defaultLocale } : {}),
            ...(dto.defaultCurrency
              ? { defaultCurrency: dto.defaultCurrency }
              : {}),
            ...(dto.defaultTimeZone
              ? { defaultTimeZone: dto.defaultTimeZone }
              : {}),
          },
        });

        // Same transaction, not a follow-up write — see the class docblock.
        await tx.organizationMembership.create({
          data: {
            organizationId: created.id,
            personId: person.id,
            role: 'ORG_OWNER',
            status: 'ACTIVE',
          },
        });

        // Audited transactionally: an organization whose creation left no trace
        // of WHO owns it is precisely the gap R2 exists to close.
        await this.audit.logInTransaction(
          tx,
          {
            organizationId: created.id,
            userId,
            personId: person.id,
          },
          {
            action: 'organization.created',
            resourceType: 'Organization',
            resourceId: created.id,
            after: created,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        );

        return created;
      })
      .catch((error: unknown) => {
        // The unique index on slug is the real authority. Two concurrent
        // creations with the same slug both pass any pre-check and one lands
        // here.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(ERRORS.organizationSlugTaken);
        }
        throw error;
      });

    return toOrganizationResponse(organization, 0);
  }

  /**
   * Organizations the caller actually belongs to.
   *
   * Driven from membership rows rather than from "orgs I created": ownership
   * can be transferred and an org can have several owners, so membership is the
   * only durable answer to "what may I see".
   */
  async listForUser(userId: string): Promise<OrganizationSummaryResponse[]> {
    const person = await this.prisma.person.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!person) return [];

    const now = new Date();
    const memberships = await this.prisma.organizationMembership.findMany({
      where: {
        personId: person.id,
        status: 'ACTIVE',
        OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        organization: { archivedAt: null },
      },
      select: {
        role: true,
        organization: {
          select: {
            id: true,
            slug: true,
            name: true,
            type: true,
            status: true,
            _count: { select: { buildings: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // One person can hold several roles in one organization (ORG_ADMIN and
    // ORG_BILLING, say). Collapse to one entry per org carrying all roles —
    // showing the same organization twice in a switcher is a bug users notice.
    const byId = new Map<string, OrganizationSummaryResponse & { roles: string[] }>();
    for (const membership of memberships) {
      const organization = membership.organization;
      const existing = byId.get(organization.id);
      if (existing) {
        if (!existing.roles.includes(membership.role)) {
          existing.roles.push(membership.role);
        }
        continue;
      }
      byId.set(organization.id, {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        type: organization.type,
        status: organization.status,
        buildingCount: organization._count.buildings,
        roles: [membership.role],
      });
    }

    return [...byId.values()];
  }

  /**
   * One organization's profile.
   *
   * Takes the proven scope, never a raw id: BuildingScopeGuard has already
   * confirmed the caller holds a live org membership, so this method never has
   * to re-ask "may you see this".
   */
  async findOne(scope: RequestScope): Promise<OrganizationResponse> {
    const organization = await this.prisma.organization.findFirst({
      where: { id: scope.organizationId, archivedAt: null },
      include: { _count: { select: { buildings: true } } },
    });

    if (!organization) {
      // Reachable when the org was archived between guard and handler.
      throw new NotFoundException(ERRORS.notFound);
    }

    return toOrganizationResponse(organization, organization._count.buildings);
  }

  /**
   * Updates the organization profile.
   *
   * `slug` cannot be changed here (it is not on the DTO) and archiving is a
   * separate endpoint, so this method can never retire a tenant by accident.
   */
  async update(
    scope: RequestScope,
    dto: UpdateOrganizationDto,
    context: RequestContext,
  ): Promise<OrganizationResponse> {
    const before = await this.prisma.organization.findFirst({
      where: { id: scope.organizationId, archivedAt: null },
    });
    if (!before) throw new NotFoundException(ERRORS.notFound);

    // Build the patch explicitly rather than spreading the DTO: a spread would
    // write `undefined` keys and, worse, would happily persist any property a
    // future DTO gains without this method being reviewed.
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.legalName !== undefined) data.legalName = dto.legalName;
    if (dto.taxIdentifier !== undefined) data.taxIdentifier = dto.taxIdentifier;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;
    if (dto.contactPhone !== undefined) data.contactPhone = dto.contactPhone;
    if (dto.defaultLocale !== undefined) data.defaultLocale = dto.defaultLocale;
    if (dto.defaultCurrency !== undefined) {
      data.defaultCurrency = dto.defaultCurrency;
    }
    if (dto.defaultTimeZone !== undefined) {
      data.defaultTimeZone = dto.defaultTimeZone;
    }

    if (Object.keys(data).length === 0) {
      return toOrganizationResponse(
        before,
        await this.countBuildings(before.id),
      );
    }

    const updated = await this.prisma.organization.update({
      where: { id: before.id },
      data,
    });

    await this.audit.log(scope, {
      action: 'organization.updated',
      resourceType: 'Organization',
      resourceId: updated.id,
      before,
      after: updated,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return toOrganizationResponse(updated, await this.countBuildings(updated.id));
  }

  /**
   * Archives the organization — a SOFT delete (R2/BM-00 rule 4).
   *
   * Refuses while any building under it is still active. Archiving a tenant out
   * from under live buildings would strand their residents: every scope lookup
   * filters on `organization.archivedAt = null`, so the buildings would keep
   * existing while nobody could reach them.
   */
  async archive(
    scope: RequestScope,
    context: RequestContext,
  ): Promise<OrganizationResponse> {
    const before = await this.prisma.organization.findFirst({
      where: { id: scope.organizationId, archivedAt: null },
    });
    if (!before) throw new NotFoundException(ERRORS.notFound);

    const activeBuildings = await this.prisma.building.count({
      where: {
        organizationId: before.id,
        archivedAt: null,
        status: { notIn: ['ARCHIVED', 'DECOMMISSIONED'] },
      },
    });
    if (activeBuildings > 0) {
      throw new ConflictException(ERRORS.conflict);
    }

    const updated = await this.prisma.organization.update({
      where: { id: before.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });

    await this.audit.log(scope, {
      action: 'organization.archived',
      resourceType: 'Organization',
      resourceId: updated.id,
      before,
      after: updated,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return toOrganizationResponse(updated, 0);
  }

  private countBuildings(organizationId: string): Promise<number> {
    return this.prisma.building.count({
      where: { organizationId, archivedAt: null },
    });
  }
}

/** Row shape shared by every organization read in this service. */
type OrganizationRow = Prisma.OrganizationGetPayload<Prisma.OrganizationDefaultArgs>;

/**
 * Maps an entity row onto the API response.
 *
 * Explicit field list, never a spread: this is the boundary where a column
 * added to the model later would otherwise start leaking to clients silently.
 */
function toOrganizationResponse(
  organization: OrganizationRow,
  buildingCount: number,
): OrganizationResponse {
  return {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    type: organization.type,
    status: organization.status,
    legalName: organization.legalName,
    taxIdentifier: organization.taxIdentifier,
    contactEmail: organization.contactEmail,
    contactPhone: organization.contactPhone,
    defaultLocale: organization.defaultLocale,
    defaultCurrency: organization.defaultCurrency,
    defaultTimeZone: organization.defaultTimeZone,
    buildingCount,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}
