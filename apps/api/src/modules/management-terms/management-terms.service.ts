import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type BuildingRole, type Person } from '@prisma/client';
import type { RequestScope } from '@bops/contracts';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import { TenantScopedRepository } from '../../core/database/tenant-scoped.repository';
import type { RequestContext } from '../auth/auth.service';
import type {
  ActivateManagementTermDto,
  CompleteManagementTermDto,
  CreateManagementTermDto,
  ManagementTermResponse,
  TermManagerSummary,
  TerminateManagementTermDto,
  UpdateManagementTermDto,
} from './dto/management-term.dto';

/**
 * Management terms — the entity that makes "manager" temporary (BM-00 rule 1,
 * BM-01 §25/§26).
 *
 * Everything about manager authority in this platform routes through here: a
 * Building has no `managerId` column, and ScopeService grants BUILDING_MANAGER
 * permissions only while the membership's term is ACTIVE and in force. So
 * closing a term IS revoking authority, with no nightly job and no second
 * source of truth to drift from.
 *
 * FIVE RULES THIS SERVICE EXISTS TO ENFORCE:
 *
 *  1. AT MOST ONE GOVERNING TERM PER BUILDING AT ANY INSTANT. Checked here for
 *     a readable Persian 409, and enforced for real by the `management_terms_no_overlap`
 *     EXCLUDE constraint in prisma/sql/001. The application check alone is a
 *     read-then-write race; the constraint alone gives users a 500. Both, and
 *     the constraint violation is translated back into the same 409.
 *
 *  2. STATUS MOVES ONLY THROUGH EXPLICIT, AUDITED ACTS. There is no settable
 *     `status` field. Taking office (`activate`), stepping down early
 *     (`terminate`) and a mandate running its course (`complete`) are three
 *     different governance events and each writes its own audit action.
 *
 *  3. A CLOSED TERM IS IMMUTABLE (R2). COMPLETED and TERMINATED terms refuse
 *     every edit. The record of who governed between which dates is the thing
 *     a later dispute is settled with; making it editable makes it worthless.
 *
 *  4. AUTHORITY IS SYNCHRONISED WITH THE SEAT, TRANSACTIONALLY. Activating a
 *     term promotes its manager's BuildingMembership to BUILDING_MANAGER bound
 *     to that term; closing it demotes them back. Both happen inside the same
 *     transaction as the status change, because a crash between the two would
 *     leave either a manager with no term or a term with no manager.
 *
 *  5. THE MANAGER MUST ALREADY BELONG TO THE BUILDING. A term cannot appoint a
 *     stranger — that would be authority granted from outside the tenant, and
 *     it would also produce a BuildingMembership row this service would have to
 *     invent, bypassing the invitation flow §33 requires.
 */
@Injectable()
export class ManagementTermsService extends TenantScopedRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  /**
   * Terms of the caller's building, newest first.
   *
   * Closed terms are always included: unlike a member list, the history IS the
   * feature here — "who managed the building in 1402" must stay answerable.
   */
  async list(scope: RequestScope): Promise<ManagementTermResponse[]> {
    const terms = await this.prisma.managementTerm.findMany({
      where: this.tenantWhere(scope),
      include: { managerPerson: true },
      orderBy: { termNumber: 'desc' },
    });

    return this.decorate(scope, terms);
  }

  /**
   * The term governing the building right now, or null.
   *
   * Derived exactly the way ScopeService derives authority — ACTIVE status AND
   * the instant inside [startsAt, endsAt) — so the UI can never show a manager
   * the guards no longer honour.
   */
  async current(scope: RequestScope): Promise<ManagementTermResponse | null> {
    const now = new Date();
    const term = await this.prisma.managementTerm.findFirst({
      where: {
        ...this.tenantWhere(scope),
        status: 'ACTIVE',
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      include: { managerPerson: true },
    });

    if (!term) return null;
    const [decorated] = await this.decorate(scope, [term]);
    return decorated ?? null;
  }

  async findOne(
    scope: RequestScope,
    termId: string,
  ): Promise<ManagementTermResponse> {
    const term = await this.loadTerm(scope, termId);
    const [decorated] = await this.decorate(scope, [term]);
    // decorate always returns one entry per input row; the fallback exists only
    // to satisfy noUncheckedIndexedAccess.
    if (!decorated) throw new NotFoundException(ERRORS.notFound);
    return decorated;
  }

  /**
   * Schedules a term. Always created SCHEDULED — see the DTO docblock.
   *
   * `termNumber` is assigned server-side as `max + 1`; the
   * `@@unique([buildingId, termNumber])` index is what makes that safe under
   * concurrency — two simultaneous creates cannot both persist number 3.
   *
   * CONCURRENCY, MEASURED RATHER THAN ASSUMED. Under simultaneous requests the
   * unique index on termNumber fires BEFORE the overlap EXCLUDE constraint does,
   * so the loser's failure arrives as P2002 on (buildingId, termNumber) — not
   * as an overlap violation. Both are the same event to a user ("someone else
   * just scheduled a term"), so both are translated to the same Persian 409.
   * Without that mapping the loser of an ordinary double-click gets a raw 500;
   * this was caught by the concurrent-create e2e test, not by reasoning.
   */
  async create(
    scope: RequestScope,
    dto: CreateManagementTermDto,
    context: RequestContext,
  ): Promise<ManagementTermResponse> {
    const buildingId = this.tenantWhere(scope).buildingId;
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;

    this.assertPeriodOrder(startsAt, endsAt);

    if (dto.managerPersonId) {
      await this.assertPersonIsBuildingMember(buildingId, dto.managerPersonId);
    }

    if (dto.previousTermId) {
      await this.assertChainableFrom(buildingId, dto.previousTermId);
    }

    // Read-then-write race is covered by the EXCLUDE constraint; this check
    // exists so the ordinary case returns a Persian 409 instead of a 500.
    await this.assertNoOverlap(buildingId, startsAt, endsAt, null);

    const created = await this.withConflictTranslation(() =>
      this.prisma.$transaction(async (tx) => {
        const highest = await tx.managementTerm.findFirst({
          where: { buildingId },
          orderBy: { termNumber: 'desc' },
          select: { termNumber: true },
        });

        const term = await tx.managementTerm.create({
          data: {
            buildingId,
            termNumber: (highest?.termNumber ?? 0) + 1,
            title: dto.title ?? null,
            status: 'SCHEDULED',
            startsAt,
            endsAt,
            managerPersonId: dto.managerPersonId ?? null,
            previousTermId: dto.previousTermId ?? null,
          },
          include: { managerPerson: true },
        });

        await this.audit.logInTransaction(tx, scope, {
          action: 'term.scheduled',
          resourceType: 'ManagementTerm',
          resourceId: term.id,
          after: term,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return term;
      }),
    );

    const [decorated] = await this.decorate(scope, [created]);
    if (!decorated) throw new NotFoundException(ERRORS.notFound);
    return decorated;
  }

  /**
   * Edits an open term. Refuses COMPLETED/TERMINATED rows (rule 3).
   *
   * Changing the manager on an ACTIVE term moves the seat: the outgoing
   * manager is demoted and the incoming one promoted in the same transaction,
   * so authority never belongs to two people or to nobody.
   */
  async update(
    scope: RequestScope,
    termId: string,
    dto: UpdateManagementTermDto,
    context: RequestContext,
  ): Promise<ManagementTermResponse> {
    const before = await this.loadTerm(scope, termId);
    this.assertOpen(before.status);

    const buildingId = before.buildingId;
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : before.startsAt;
    const endsAt = dto.clearEndsAt
      ? null
      : dto.endsAt
        ? new Date(dto.endsAt)
        : before.endsAt;

    this.assertPeriodOrder(startsAt, endsAt);

    if (dto.managerPersonId) {
      await this.assertPersonIsBuildingMember(buildingId, dto.managerPersonId);
    }

    if (dto.startsAt || dto.endsAt || dto.clearEndsAt) {
      await this.assertNoOverlap(buildingId, startsAt, endsAt, before.id);
    }

    const managerChanged =
      dto.managerPersonId !== undefined &&
      dto.managerPersonId !== before.managerPersonId;

    const updated = await this.withConflictTranslation(() =>
      this.prisma.$transaction(async (tx) => {
        const term = await tx.managementTerm.update({
          where: { id: before.id },
          data: {
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            startsAt,
            endsAt,
            ...(dto.managerPersonId !== undefined
              ? { managerPersonId: dto.managerPersonId }
              : {}),
            ...(dto.handoverStatus !== undefined
              ? {
                  handoverStatus: dto.handoverStatus,
                  handoverCompletedAt:
                    dto.handoverStatus === 'COMPLETED' ? new Date() : null,
                }
              : {}),
          },
          include: { managerPerson: true },
        });

        // Only an ACTIVE term confers authority, so only an ACTIVE term's seat
        // change needs the membership rows moved. On a SCHEDULED term the
        // manager field is a plan, not a grant.
        if (managerChanged && before.status === 'ACTIVE') {
          if (before.managerPersonId) {
            await this.demoteManager(tx, buildingId, before.managerPersonId);
          }
          if (dto.managerPersonId) {
            await this.promoteManager(
              tx,
              buildingId,
              dto.managerPersonId,
              term.id,
            );
          }
        }

        await this.audit.logInTransaction(tx, scope, {
          action: managerChanged ? 'term.manager_changed' : 'term.updated',
          resourceType: 'ManagementTerm',
          resourceId: term.id,
          before,
          after: term,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return term;
      }),
    );

    const [decorated] = await this.decorate(scope, [updated]);
    if (!decorated) throw new NotFoundException(ERRORS.notFound);
    return decorated;
  }

  /**
   * Puts a SCHEDULED term into force — the moment authority actually transfers.
   *
   * If another term is governing, the caller must say so explicitly via
   * `closeActiveTerm`. Refusing by default is deliberate: ending an elected
   * officeholder's mandate as an invisible side effect is exactly the kind of
   * untraceable authority change §25 forbids.
   */
  async activate(
    scope: RequestScope,
    termId: string,
    dto: ActivateManagementTermDto,
    context: RequestContext,
  ): Promise<ManagementTermResponse> {
    const before = await this.loadTerm(scope, termId);
    if (before.status !== 'SCHEDULED') {
      throw new ConflictException(ERRORS.termNotSchedulable);
    }

    const buildingId = before.buildingId;
    const now = new Date();

    // A term whose whole window is already in the past cannot take office.
    // This is not a nicety: activation moves `startsAt` forward to now (see
    // below), which on an expired term would produce endsAt < startsAt and
    // trip the `management_terms_period_order` CHECK as a raw 500. Refusing it
    // here is also the correct governance answer — a mandate that expired
    // before anyone took office needs a new term, not a retroactive one.
    if (before.endsAt && before.endsAt <= now) {
      throw new ConflictException(ERRORS.termWindowAlreadyPassed);
    }

    const active = await this.prisma.managementTerm.findFirst({
      where: { buildingId, status: 'ACTIVE' },
      include: { managerPerson: true },
    });

    if (active && !dto.closeActiveTerm) {
      throw new ConflictException(ERRORS.termAlreadyActive);
    }

    const updated = await this.withConflictTranslation(() =>
      this.prisma.$transaction(async (tx) => {
        if (active) {
          // Closed as COMPLETED, not TERMINATED: a planned handover to a
          // successor is a mandate ending normally. TERMINATED is reserved for
          // an early removal, which carries a required reason.
          await tx.managementTerm.update({
            where: { id: active.id },
            data: {
              status: 'COMPLETED',
              // An open-ended outgoing term would otherwise keep overlapping
              // the incoming one forever and trip the EXCLUDE constraint.
              endsAt: active.endsAt ?? now,
              handoverStatus: 'COMPLETED',
              handoverCompletedAt: now,
            },
          });

          if (active.managerPersonId) {
            await this.demoteManager(tx, buildingId, active.managerPersonId);
          }

          await this.audit.logInTransaction(tx, scope, {
            action: 'term.completed',
            resourceType: 'ManagementTerm',
            resourceId: active.id,
            before: active,
            after: { closedBySuccessor: before.id },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          });
        }

        const term = await tx.managementTerm.update({
          where: { id: before.id },
          data: {
            status: 'ACTIVE',
            // A term activated late starts now, not retroactively: back-dating
            // would silently claim authority over decisions taken before the
            // handover actually happened.
            startsAt: before.startsAt > now ? before.startsAt : now,
            ...(active ? { previousTermId: active.id } : {}),
          },
          include: { managerPerson: true },
        });

        if (term.managerPersonId) {
          await this.promoteManager(
            tx,
            buildingId,
            term.managerPersonId,
            term.id,
          );
        }

        await this.audit.logInTransaction(tx, scope, {
          action: 'term.activated',
          resourceType: 'ManagementTerm',
          resourceId: term.id,
          before,
          after: term,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return term;
      }),
    );

    const [decorated] = await this.decorate(scope, [updated]);
    if (!decorated) throw new NotFoundException(ERRORS.notFound);
    return decorated;
  }

  /**
   * Ends a term early, with a required reason (R2: record why, never delete).
   *
   * Note this permission is deliberately withheld from BUILDING_MANAGER in the
   * role matrix — a temporary officeholder must not be able to terminate the
   * term that bounds their own mandate.
   */
  async terminate(
    scope: RequestScope,
    termId: string,
    dto: TerminateManagementTermDto,
    context: RequestContext,
  ): Promise<ManagementTermResponse> {
    const before = await this.loadTerm(scope, termId);
    this.assertOpen(before.status);

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const term = await tx.managementTerm.update({
        where: { id: before.id },
        data: {
          status: 'TERMINATED',
          terminationReason: dto.reason,
          terminatedAt: now,
          // The interval is closed at the moment authority ended so that
          // "who governed on date X" stays answerable, and so the row stops
          // participating in the overlap constraint.
          endsAt: before.endsAt && before.endsAt < now ? before.endsAt : now,
        },
        include: { managerPerson: true },
      });

      if (before.status === 'ACTIVE' && before.managerPersonId) {
        await this.demoteManager(tx, before.buildingId, before.managerPersonId);
      }

      await this.audit.logInTransaction(tx, scope, {
        action: 'term.terminated',
        resourceType: 'ManagementTerm',
        resourceId: term.id,
        before,
        after: term,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return term;
    });

    const [decorated] = await this.decorate(scope, [updated]);
    if (!decorated) throw new NotFoundException(ERRORS.notFound);
    return decorated;
  }

  /** Closes a term normally — the mandate ran its course. */
  async complete(
    scope: RequestScope,
    termId: string,
    dto: CompleteManagementTermDto,
    context: RequestContext,
  ): Promise<ManagementTermResponse> {
    const before = await this.loadTerm(scope, termId);
    if (before.status !== 'ACTIVE') {
      throw new ConflictException(ERRORS.termAlreadyClosed);
    }

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const term = await tx.managementTerm.update({
        where: { id: before.id },
        data: {
          status: 'COMPLETED',
          endsAt: before.endsAt && before.endsAt < now ? before.endsAt : now,
        },
        include: { managerPerson: true },
      });

      if (before.managerPersonId) {
        await this.demoteManager(tx, before.buildingId, before.managerPersonId);
      }

      await this.audit.logInTransaction(tx, scope, {
        action: 'term.completed',
        resourceType: 'ManagementTerm',
        resourceId: term.id,
        before,
        after: { ...term, note: dto.note ?? null },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return term;
    });

    const [decorated] = await this.decorate(scope, [updated]);
    if (!decorated) throw new NotFoundException(ERRORS.notFound);
    return decorated;
  }

  // -------------------------------------------------------------------------
  //  internals
  // -------------------------------------------------------------------------

  /**
   * Loads a term inside the caller's building.
   *
   * NotFound rather than Forbidden on a foreign id: confirming "that term
   * exists but is not yours" would let a caller enumerate other tenants' rows.
   */
  private async loadTerm(scope: RequestScope, termId: string) {
    const term = await this.prisma.managementTerm.findFirst({
      where: { id: termId, ...this.tenantWhere(scope) },
      include: { managerPerson: true },
    });
    if (!term) throw new NotFoundException(ERRORS.notFound);
    return term;
  }

  private assertOpen(status: string): void {
    if (status === 'COMPLETED' || status === 'TERMINATED') {
      throw new ConflictException(ERRORS.termClosedNotEditable);
    }
  }

  private assertPeriodOrder(startsAt: Date, endsAt: Date | null): void {
    if (endsAt && endsAt <= startsAt) {
      throw new BadRequestException(ERRORS.validationFailed);
    }
  }

  /**
   * A term may only appoint someone who already belongs to the building
   * (rule 5). ENDED memberships do not count — appointing a former resident
   * would grant authority to someone with no current standing.
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
      throw new ConflictException(ERRORS.termManagerNotMember);
    }
  }

  /**
   * The chain of custody is one-to-one: `previousTermId` is `@unique`, so a
   * term can be succeeded by at most one successor. Checking here turns what
   * would be a raw unique-violation 500 into a meaningful Persian conflict.
   */
  private async assertChainableFrom(
    buildingId: string,
    previousTermId: string,
  ): Promise<void> {
    const previous = await this.prisma.managementTerm.findFirst({
      where: { id: previousTermId, buildingId },
      select: { id: true, nextTerm: { select: { id: true } } },
    });
    if (!previous) throw new NotFoundException(ERRORS.notFound);
    if (previous.nextTerm) {
      throw new ConflictException(ERRORS.termChainAlreadyLinked);
    }
  }

  /**
   * Application-level overlap check against SCHEDULED/ACTIVE terms, mirroring
   * the WHERE clause of the `management_terms_no_overlap` EXCLUDE constraint.
   *
   * Half-open semantics: a term ending exactly when the next begins does NOT
   * overlap, which is what makes a clean handover expressible.
   */
  private async assertNoOverlap(
    buildingId: string,
    startsAt: Date,
    endsAt: Date | null,
    excludeTermId: string | null,
  ): Promise<void> {
    const clash = await this.prisma.managementTerm.findFirst({
      where: {
        buildingId,
        status: { in: ['SCHEDULED', 'ACTIVE'] },
        ...(excludeTermId ? { id: { not: excludeTermId } } : {}),
        // existing.startsAt < new.endsAt  AND  existing.endsAt > new.startsAt
        ...(endsAt ? { startsAt: { lt: endsAt } } : {}),
        OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }],
      },
      select: { id: true },
    });

    if (clash) {
      throw new ConflictException(ERRORS.termOverlapsExisting);
    }
  }

  /**
   * Runs a write and converts the database's own rejections into the same
   * Persian 409 the application-level checks produce.
   *
   * The constraints are the real guarantee — they are evaluated at commit time,
   * so they catch the interleaving two concurrent requests slip through the
   * read-then-write checks above. Without this translation the loser of that
   * race sees an opaque 500.
   *
   * TWO distinct database rejections mean the same thing here:
   *   - `management_terms_no_overlap` (EXCLUDE): the periods collide.
   *   - unique (buildingId, termNumber): another term was created concurrently
   *     and took the number this transaction computed. Observed to fire FIRST
   *     in the concurrent case, so omitting it leaves the common double-click
   *     returning a 500.
   */
  private async withConflictTranslation<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isOverlapViolation(error)) {
        throw new ConflictException(ERRORS.termOverlapsExisting);
      }
      if (isTermNumberCollision(error)) {
        throw new ConflictException(ERRORS.termOverlapsExisting);
      }
      throw error;
    }
  }

  /**
   * Grants the manager seat: the person's building membership becomes
   * BUILDING_MANAGER and is BOUND to this term via `managementTermId`.
   *
   * That binding is what makes the grant self-expiring — ScopeService drops the
   * membership's permissions the moment the linked term stops being ACTIVE, so
   * no cron job is required to revoke a stale manager.
   */
  private async promoteManager(
    tx: Prisma.TransactionClient,
    buildingId: string,
    personId: string,
    termId: string,
  ): Promise<void> {
    await tx.buildingMembership.updateMany({
      where: { buildingId, personId, status: { not: 'ENDED' } },
      data: { role: 'BUILDING_MANAGER', managementTermId: termId },
    });
  }

  /**
   * Revokes the manager seat when a term closes.
   *
   * The person is demoted to OWNER rather than removed: they remain a resident
   * of the building, and ending their membership would destroy their unit
   * attachments and ownership history over a governance change.
   */
  private async demoteManager(
    tx: Prisma.TransactionClient,
    buildingId: string,
    personId: string,
  ): Promise<void> {
    await tx.buildingMembership.updateMany({
      where: {
        buildingId,
        personId,
        status: { not: 'ENDED' },
        role: 'BUILDING_MANAGER',
      },
      data: { role: 'OWNER', managementTermId: null },
    });
  }

  /**
   * Maps rows onto the response shape, resolving each manager's CURRENT
   * building role in one extra query for the whole page rather than per row.
   */
  private async decorate(
    scope: RequestScope,
    terms: readonly (TermRow & { managerPerson: Person | null })[],
  ): Promise<ManagementTermResponse[]> {
    const personIds = terms
      .map((term) => term.managerPersonId)
      .filter((id): id is string => id !== null);

    const roles = new Map<string, BuildingRole>();
    if (personIds.length) {
      const memberships = await this.prisma.buildingMembership.findMany({
        where: {
          ...this.tenantWhere(scope),
          personId: { in: personIds },
          status: { not: 'ENDED' },
        },
        select: { personId: true, role: true },
      });
      for (const row of memberships) roles.set(row.personId, row.role);
    }

    const now = new Date();

    return terms.map((term) => ({
      id: term.id,
      buildingId: term.buildingId,
      termNumber: term.termNumber,
      title: term.title,
      status: term.status,
      startsAt: term.startsAt,
      endsAt: term.endsAt,
      isCurrent:
        term.status === 'ACTIVE' &&
        term.startsAt <= now &&
        (term.endsAt === null || term.endsAt > now),
      manager: toManagerSummary(term.managerPerson, roles),
      handoverStatus: term.handoverStatus,
      handoverCompletedAt: term.handoverCompletedAt,
      previousTermId: term.previousTermId,
      terminationReason: term.terminationReason,
      terminatedAt: term.terminatedAt,
      createdAt: term.createdAt,
    }));
  }
}

/** Shape of the term rows this service reads — narrowed for `decorate`. */
type TermRow = {
  id: string;
  buildingId: string;
  termNumber: number;
  title: string | null;
  status: ManagementTermResponse['status'];
  startsAt: Date;
  endsAt: Date | null;
  managerPersonId: string | null;
  handoverStatus: ManagementTermResponse['handoverStatus'];
  handoverCompletedAt: Date | null;
  previousTermId: string | null;
  terminationReason: string | null;
  terminatedAt: Date | null;
  createdAt: Date;
};

/**
 * A term's manager as shown to clients.
 *
 * Contact details are deliberately absent — unlike the member directory this
 * needs no PERSON_READ_CONTACT branch, because everyone entitled to read terms
 * (TERM_READ is in RESIDENT_BASE) may know WHO manages the building without
 * thereby being handed their phone number (BM-00 rule 6).
 */
function toManagerSummary(
  person: Person | null,
  roles: ReadonlyMap<string, BuildingRole>,
): TermManagerSummary | null {
  if (!person) return null;
  return {
    personId: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    displayName: person.displayName,
    buildingRole: roles.get(person.id) ?? null,
  };
}

/**
 * True for the Postgres exclusion-constraint rejection raised by
 * `management_terms_no_overlap`.
 *
 * Prisma surfaces an EXCLUDE violation as P2010 (raw query failure) or P2002
 * depending on the path, and the driver error carries SQLSTATE 23P01. Matching
 * the constraint NAME as well keeps an unrelated exclusion violation from being
 * mislabelled as a term overlap.
 */
/**
 * True for the unique-index rejection on (buildingId, termNumber).
 *
 * Matched on Prisma's structured `code`/`meta` rather than on message text,
 * because the message is localised by driver version while P2002 is stable.
 * The target check keeps an unrelated unique violation — `previousTermId`, for
 * instance — from being reported as a scheduling race.
 */
function isTermNumberCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;

  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const fields = Array.isArray(target)
    ? target.map(String)
    : typeof target === 'string'
      ? [target]
      : [];

  return fields.some((field) => field.includes('termNumber'));
}

function isOverlapViolation(error: unknown): boolean {
  const text =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? `${error.code} ${error.message}`
      : error instanceof Error
        ? error.message
        : '';

  return (
    text.includes('management_terms_no_overlap') ||
    (text.includes('23P01') && text.includes('management_terms'))
  );
}
