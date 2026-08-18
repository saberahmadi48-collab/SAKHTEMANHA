import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Invitation } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';
import { createHash, randomBytes } from 'node:crypto';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import type { RequestContext } from '../auth/auth.service';
import type {
  AcceptInvitationResponse,
  CreateBuildingInvitationDto,
  CreateOrganizationInvitationDto,
  CreatedInvitationResponse,
  InvitationPreviewResponse,
  InvitationResponse,
} from './dto/invitation.dto';

/**
 * Invitations — the ONLY sanctioned path from "no access" to "member"
 * (BM-01 §33, §34).
 *
 * §33 is explicit that knowing a building exists must never be enough to join
 * it. Every membership in the platform is therefore created by exactly one of
 * two paths: the org-creation transaction (which grants the creator ORG_OWNER
 * over what they just made), or redeeming an invitation here. There is no
 * self-service "join" endpoint anywhere, and adding one would bypass this file.
 *
 * FOUR PROPERTIES THAT MAKE THIS SAFE, each deliberate:
 *
 *  1. THE INVITEE NEVER STATES THEIR OWN SCOPE OR ROLE. `accept` takes a token
 *     and nothing else; organization, building, unit and role are all read from
 *     the stored row. A tampered request body cannot widen the grant because
 *     there is no field in which to tamper.
 *
 *  2. ONLY THE HASH IS STORED. Like refresh tokens, the raw token exists once —
 *     in the create response, for delivery — and the database holds
 *     sha256(token). A database leak yields no acceptable invitation. The
 *     lookup is BY HASH, so it is a single indexed equality check rather than a
 *     scan-and-compare, which also removes any timing signal.
 *
 *  3. ACCEPTANCE IS ONE TRANSACTION. Marking the invitation ACCEPTED, creating
 *     the Person link if needed, and minting the membership commit together.
 *     Split across statements, a failure between them would either consume an
 *     invitation that granted nothing, or grant access that no invitation
 *     records — both unrecoverable without manual database surgery.
 *
 *  4. STATUS IS DERIVED, NOT TRUSTED. A PENDING row whose `expiresAt` has
 *     passed is treated as expired at read time. Relying on a sweeper job to
 *     flip the column would mean a missed cron run silently extends every
 *     invitation in the system.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  //  creation
  // -------------------------------------------------------------------------

  /**
   * Invites someone into the ORGANIZATION the caller has proven access to.
   *
   * The scope supplies the tenant; the DTO supplies only who and what role.
   */
  async createForOrganization(
    scope: RequestScope,
    dto: CreateOrganizationInvitationDto,
    context: RequestContext,
  ): Promise<CreatedInvitationResponse> {
    this.assertDeliverable(dto.email, dto.phoneNumber);

    // An ORG_OWNER invitation grants everything the inviter has and more, so it
    // is restricted to callers who already hold that tier. Without this, an
    // ORG_ADMIN could invite a confederate as ORG_OWNER and inherit the
    // authority they were deliberately denied (see the permission matrix, where
    // ORG_ADMIN is refused BUILDING_ARCHIVE precisely to keep that boundary).
    if (
      dto.role === 'ORG_OWNER' &&
      !scope.organizationRoles.includes('ORG_OWNER')
    ) {
      throw new ForbiddenException(ERRORS.forbidden);
    }

    const personId = await this.resolveInvitedPerson(dto.personId);

    return this.persist(scope, context, {
      organizationId: scope.organizationId,
      buildingId: null,
      unitId: null,
      organizationRole: dto.role,
      buildingRole: null,
      email: dto.email ?? null,
      phoneNumber: dto.phoneNumber ?? null,
      personId,
      message: dto.message ?? null,
      expiresInDays: dto.expiresInDays,
    });
  }

  /**
   * Invites someone into a specific BUILDING, optionally bound to one unit.
   *
   * `unitId` is re-validated against the scoped building rather than trusted:
   * a well-formed UUID from a different tenant must not become a cross-building
   * unit binding.
   */
  async createForBuilding(
    scope: RequestScope,
    dto: CreateBuildingInvitationDto,
    context: RequestContext,
  ): Promise<CreatedInvitationResponse> {
    this.assertDeliverable(dto.email, dto.phoneNumber);

    const buildingId = this.requireBuildingScope(scope);

    if (dto.unitId) {
      const unit = await this.prisma.unit.findFirst({
        where: { id: dto.unitId, buildingId, archivedAt: null },
        select: { id: true },
      });
      // NotFound rather than Forbidden: confirming "that unit exists but is in
      // another building" would leak the other tenant's inventory.
      if (!unit) throw new NotFoundException(ERRORS.unitNotInBuilding);
    }

    const personId = await this.resolveInvitedPerson(dto.personId);

    return this.persist(scope, context, {
      organizationId: scope.organizationId,
      buildingId,
      unitId: dto.unitId ?? null,
      organizationRole: null,
      buildingRole: dto.role,
      email: dto.email ?? null,
      phoneNumber: dto.phoneNumber ?? null,
      personId,
      message: dto.message ?? null,
      expiresInDays: dto.expiresInDays,
    });
  }

  // -------------------------------------------------------------------------
  //  reading
  // -------------------------------------------------------------------------

  /** Invitations issued for the caller's organization (org tier only). */
  async listForOrganization(
    scope: RequestScope,
    includeResolved: boolean,
  ): Promise<InvitationResponse[]> {
    const rows = await this.prisma.invitation.findMany({
      where: {
        organizationId: scope.organizationId,
        buildingId: null,
        ...(includeResolved ? {} : { status: 'PENDING' }),
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => toInvitationResponse(row));
  }

  /** Invitations issued for one building. */
  async listForBuilding(
    scope: RequestScope,
    includeResolved: boolean,
  ): Promise<InvitationResponse[]> {
    const buildingId = this.requireBuildingScope(scope);

    const rows = await this.prisma.invitation.findMany({
      where: {
        buildingId,
        ...(includeResolved ? {} : { status: 'PENDING' }),
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => toInvitationResponse(row));
  }

  /**
   * Shows what an invitation token grants, WITHOUT redeeming it.
   *
   * Unauthenticated by necessity: the recipient may not have an account yet, so
   * the acceptance screen has to render before they can log in (§32). It is
   * safe because it returns display NAMES only — no ids that could be fed to
   * another endpoint — and because holding the token already implies being the
   * intended recipient.
   */
  async preview(token: string): Promise<InvitationPreviewResponse> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        organization: { select: { name: true } },
        building: { select: { name: true } },
        unit: { select: { label: true } },
      },
    });

    // Same error for "no such token" and "already used": distinguishing them
    // would let someone with a list of guessed tokens learn which ones are real.
    if (!invitation) throw new NotFoundException(ERRORS.invitationInvalid);
    this.assertRedeemable(invitation);

    return {
      organizationName: invitation.organization.name,
      buildingName: invitation.building?.name ?? null,
      unitLabel: invitation.unit?.label ?? null,
      organizationRole: invitation.organizationRole,
      buildingRole: invitation.buildingRole,
      expiresAt: invitation.expiresAt,
      message: invitation.message,
    };
  }

  // -------------------------------------------------------------------------
  //  redemption
  // -------------------------------------------------------------------------

  /**
   * Redeems an invitation for the authenticated caller.
   *
   * Everything that matters happens inside ONE transaction — see property 3 in
   * the class docblock. Note the caller supplies only `userId` (from the
   * verified JWT) and the token; the grant is entirely server-determined.
   */
  async accept(
    userId: string,
    token: string,
    context: RequestContext,
  ): Promise<AcceptInvitationResponse> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!invitation) throw new NotFoundException(ERRORS.invitationInvalid);
    this.assertRedeemable(invitation);

    const person = await this.prisma.person.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!person) throw new ForbiddenException(ERRORS.personProfileRequired);

    // An invitation pre-linked to a specific Person may only be redeemed by
    // that person. Otherwise a forwarded link would let the wrong account claim
    // a named grant — "invite the owner of flat 12" must not become "whoever
    // opens the email first owns flat 12".
    if (invitation.personId && invitation.personId !== person.id) {
      this.logger.warn(
        `Invitation ${invitation.id} presented by person=${person.id} but bound to person=${invitation.personId}`,
      );
      throw new ForbiddenException(ERRORS.invitationInvalid);
    }

    await this.prisma.$transaction(async (tx) => {
      // Re-read INSIDE the transaction and only accept a still-PENDING row.
      // Two concurrent accepts both pass the checks above; this makes the
      // second one a no-op instead of a second membership.
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException(ERRORS.invitationAlreadyUsed);
      }

      if (invitation.buildingId && invitation.buildingRole) {
        await this.grantBuildingMembership(tx, invitation, person.id);
      } else if (invitation.organizationRole) {
        await this.grantOrganizationMembership(tx, invitation, person.id);
      } else {
        // A row with neither role is a data-integrity failure, not a user
        // error: `persist` always writes exactly one. Fail rather than consume
        // the invitation and grant nothing.
        throw new ConflictException(ERRORS.invitationInvalid);
      }

      // Audited transactionally: a membership whose creation left no trace of
      // which invitation authorised it is exactly the gap R2 exists to close.
      await this.audit.logInTransaction(
        tx,
        {
          organizationId: invitation.organizationId,
          buildingId: invitation.buildingId,
          userId,
          personId: person.id,
        },
        {
          action: 'invitation.accepted',
          resourceType: 'Invitation',
          resourceId: invitation.id,
          after: {
            organizationRole: invitation.organizationRole,
            buildingRole: invitation.buildingRole,
            buildingId: invitation.buildingId,
            unitId: invitation.unitId,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      );
    });

    return {
      organizationId: invitation.organizationId,
      buildingId: invitation.buildingId,
      unitId: invitation.unitId,
      organizationRole: invitation.organizationRole,
      buildingRole: invitation.buildingRole,
    };
  }

  /**
   * Withdraws a pending invitation (§34).
   *
   * A REVOKED row is kept, never deleted (R2) — "who invited whom and then
   * thought better of it" is exactly the sort of fact an audit needs.
   */
  async revoke(
    scope: RequestScope,
    invitationId: string,
    context: RequestContext,
  ): Promise<InvitationResponse> {
    const before = await this.prisma.invitation.findFirst({
      where: {
        id: invitationId,
        organizationId: scope.organizationId,
        // When the caller proved BUILDING scope, restrict to that building.
        // Without this an org-wide id would be revocable from any building
        // route the caller happens to have access to.
        ...(scope.buildingId ? { buildingId: scope.buildingId } : {}),
      },
    });

    if (!before) throw new NotFoundException(ERRORS.notFound);
    if (before.status !== 'PENDING') {
      throw new ConflictException(ERRORS.invitationNotPending);
    }

    const updated = await this.prisma.invitation.update({
      where: { id: before.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    await this.audit.log(scope, {
      action: 'invitation.revoked',
      resourceType: 'Invitation',
      resourceId: updated.id,
      before,
      after: updated,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return toInvitationResponse(updated);
  }

  // -------------------------------------------------------------------------
  //  internals
  // -------------------------------------------------------------------------

  /**
   * Writes the invitation row and returns the raw token exactly once.
   *
   * The token is 32 bytes of CSPRNG output, base64url-encoded. It is never
   * logged and never stored in this form — see property 2 in the class
   * docblock.
   */
  private async persist(
    scope: RequestScope,
    context: RequestContext,
    input: {
      organizationId: string;
      buildingId: string | null;
      unitId: string | null;
      organizationRole: Invitation['organizationRole'];
      buildingRole: Invitation['buildingRole'];
      email: string | null;
      phoneNumber: string | null;
      personId: string | null;
      message: string | null;
      expiresInDays?: number;
    },
  ): Promise<CreatedInvitationResponse> {
    await this.assertNoLivePendingInvitation(input);

    const token = randomBytes(32).toString('base64url');
    const days = input.expiresInDays ?? INVITATION_DEFAULT_TTL_DAYS;
    const expiresAt = new Date(Date.now() + days * DAY_MS);

    const created = await this.prisma.invitation.create({
      data: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        unitId: input.unitId,
        tokenHash: hashToken(token),
        email: input.email,
        phoneNumber: input.phoneNumber,
        organizationRole: input.organizationRole,
        buildingRole: input.buildingRole,
        personId: input.personId,
        status: 'PENDING',
        expiresAt,
        invitedByUserId: scope.userId,
        message: input.message,
      },
    });

    // Non-transactional log: AuditService redacts `tokenHash`, and a failed
    // audit write must not roll back a legitimate invitation.
    await this.audit.log(scope, {
      action: input.buildingId
        ? 'invitation.building.created'
        : 'invitation.organization.created',
      resourceType: 'Invitation',
      resourceId: created.id,
      after: created,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { invitation: toInvitationResponse(created), token };
  }

  /**
   * Blocks a second live invitation for the same recipient into the same scope
   * and role.
   *
   * Not a uniqueness constraint: expired and revoked rows must be repeatable
   * (re-inviting someone whose invitation lapsed is normal), so "live" here
   * means PENDING and not yet past `expiresAt`.
   */
  private async assertNoLivePendingInvitation(input: {
    organizationId: string;
    buildingId: string | null;
    organizationRole: Invitation['organizationRole'];
    buildingRole: Invitation['buildingRole'];
    email: string | null;
    phoneNumber: string | null;
    personId: string | null;
  }): Promise<void> {
    const recipient: Prisma.InvitationWhereInput[] = [];
    if (input.personId) recipient.push({ personId: input.personId });
    if (input.email) recipient.push({ email: input.email });
    if (input.phoneNumber) recipient.push({ phoneNumber: input.phoneNumber });
    if (recipient.length === 0) return;

    const existing = await this.prisma.invitation.findFirst({
      where: {
        organizationId: input.organizationId,
        buildingId: input.buildingId,
        organizationRole: input.organizationRole,
        buildingRole: input.buildingRole,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        OR: recipient,
      },
      select: { id: true },
    });

    if (existing) throw new ConflictException(ERRORS.membershipAlreadyExists);
  }

  /**
   * Mints the building membership an accepted invitation grants.
   *
   * Idempotent by design: if a live membership with the same role already
   * exists, the invitation is still consumed but no duplicate row is written.
   * Two ACTIVE rows for the same (building, person, role) would make role
   * removal require deleting an unknown number of rows — and the partial unique
   * index in prisma/sql/002 forbids it anyway.
   */
  private async grantBuildingMembership(
    tx: Prisma.TransactionClient,
    invitation: Invitation,
    personId: string,
  ): Promise<void> {
    const buildingId = invitation.buildingId;
    const role = invitation.buildingRole;
    if (!buildingId || !role) return;

    const now = new Date();
    const existing = await tx.buildingMembership.findFirst({
      where: {
        buildingId,
        personId,
        role,
        status: 'ACTIVE',
        OR: [{ endedAt: null }, { endedAt: { gt: now } }],
      },
      select: { id: true },
    });

    if (!existing) {
      await tx.buildingMembership.create({
        data: { buildingId, personId, role, status: 'ACTIVE' },
      });
    }

    // A unit-bound invitation also grants unit-level visibility. Same
    // idempotence rule.
    if (invitation.unitId) {
      const existingUnit = await tx.unitMembership.findFirst({
        where: {
          buildingId,
          unitId: invitation.unitId,
          personId,
          status: 'ACTIVE',
          OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        },
        select: { id: true },
      });

      if (!existingUnit) {
        await tx.unitMembership.create({
          data: {
            buildingId,
            unitId: invitation.unitId,
            personId,
            status: 'ACTIVE',
          },
        });
      }
    }
  }

  /** Organization-tier equivalent of `grantBuildingMembership`. */
  private async grantOrganizationMembership(
    tx: Prisma.TransactionClient,
    invitation: Invitation,
    personId: string,
  ): Promise<void> {
    const role = invitation.organizationRole;
    if (!role) return;

    const now = new Date();
    const existing = await tx.organizationMembership.findFirst({
      where: {
        organizationId: invitation.organizationId,
        personId,
        role,
        status: 'ACTIVE',
        OR: [{ endedAt: null }, { endedAt: { gt: now } }],
      },
      select: { id: true },
    });

    if (existing) return;

    await tx.organizationMembership.create({
      data: {
        organizationId: invitation.organizationId,
        personId,
        role,
        status: 'ACTIVE',
      },
    });
  }

  /**
   * Rejects an invitation that cannot be redeemed.
   *
   * Expiry is computed from `expiresAt`, NOT from `status` — see property 4 in
   * the class docblock.
   */
  private assertRedeemable(invitation: Invitation): void {
    if (invitation.status === 'ACCEPTED') {
      throw new ConflictException(ERRORS.invitationAlreadyUsed);
    }
    if (invitation.status === 'REVOKED') {
      throw new NotFoundException(ERRORS.invitationInvalid);
    }
    if (
      invitation.status === 'EXPIRED' ||
      invitation.expiresAt <= new Date()
    ) {
      throw new ConflictException(ERRORS.invitationExpired);
    }
  }

  /** At least one delivery channel must exist, or nobody can receive the link. */
  private assertDeliverable(
    email: string | undefined,
    phoneNumber: string | undefined,
  ): void {
    if (!email && !phoneNumber) {
      throw new BadRequestException(ERRORS.emailOrPhoneRequired);
    }
  }

  /** Confirms a pre-linked Person exists before it is written onto the row. */
  private async resolveInvitedPerson(
    personId: string | undefined,
  ): Promise<string | null> {
    if (!personId) return null;

    const person = await this.prisma.person.findFirst({
      where: { id: personId, archivedAt: null },
      select: { id: true },
    });
    if (!person) throw new NotFoundException(ERRORS.notFound);

    return person.id;
  }

  /**
   * Narrows a scope to a proven building id.
   * Reaching a building-scoped operation without one is a routing bug, so this
   * throws rather than letting the query run org-wide.
   */
  private requireBuildingScope(scope: RequestScope): string {
    if (!scope.buildingId) {
      throw new ForbiddenException(ERRORS.buildingNotAccessible);
    }
    return scope.buildingId;
  }
}

/** Default validity window when the caller does not specify one. */
const INVITATION_DEFAULT_TTL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * sha256 of an invitation token. Same reasoning as refresh tokens in
 * AuthService: the token is already 256 bits of CSPRNG output, so a slow KDF
 * buys nothing, and hashing lets the lookup be an indexed equality on
 * `tokenHash` rather than a scan.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Maps an invitation row onto the API response.
 *
 * TWO THINGS THIS FUNCTION MUST KEEP DOING:
 *  - never emit `tokenHash` (or the token), and
 *  - mask contact details, so a MEMBER_READ holder cannot harvest an address
 *    book from the pending-invitation list (BM-00 rule 6).
 *
 * `status` is computed rather than copied: a PENDING row past its expiry is
 * reported as EXPIRED even though no sweeper has touched the column yet.
 */
function toInvitationResponse(invitation: Invitation): InvitationResponse {
  const isStale =
    invitation.status === 'PENDING' && invitation.expiresAt <= new Date();

  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    buildingId: invitation.buildingId,
    unitId: invitation.unitId,
    email: maskEmail(invitation.email),
    phoneNumber: maskPhone(invitation.phoneNumber),
    organizationRole: invitation.organizationRole,
    buildingRole: invitation.buildingRole,
    status: isStale ? 'EXPIRED' : invitation.status,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    message: invitation.message,
    createdAt: invitation.createdAt,
  };
}

/**
 * "sara@example.com" -> "s***@example.com".
 * Enough for the inviter to recognise who they invited, not enough to harvest.
 */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const first = email.slice(0, 1);
  return `${first}***${email.slice(at)}`;
}

/** "09121234567" -> "0912***4567". */
function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length <= 7) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}
