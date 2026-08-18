import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERRORS } from '@bops/i18n';

import { AuditService } from '../../core/audit/audit.service';
import { PrismaService } from '../../core/database/prisma.service';
import type { RequestContext } from '../auth/auth.service';
import type {
  MyProfileResponse,
  UpdateMyProfileDto,
} from './dto/profile.dto';

/**
 * Self-service profile management — BM-02 §41 (`/api/users/me/profile`).
 *
 * THE SUBJECT IS ALWAYS THE AUTHENTICATED CALLER. Every method here takes a
 * `userId` that came from the verified JWT, never from a route param or body.
 * That is what makes this service safe to expose with `@ScopedTo('none')`: there
 * is no tenant to check because there is no way to address anyone else's row.
 *
 * TWO RULES THIS SERVICE EXISTS TO ENFORCE:
 *
 *  1. IDENTITY DATA FREEZES ONCE IT HAS BEEN RELIED UPON. A person may edit
 *     their national id freely while nothing is verified against it. The moment
 *     a manager marks an ownership or occupancy VERIFIED, that verification is
 *     an attestation about a specific identity — letting the subject silently
 *     swap the number afterwards would turn "we checked the deed against this
 *     person" into a statement about someone else entirely. BM-02 §41 requires
 *     administrative approval for exactly this class of change.
 *
 *  2. CONSENT IS SELF-SERVICE, ALWAYS. `phoneIsPublic` is editable even when
 *     identity is locked. Consent that only an administrator can withdraw is not
 *     consent (BM-00 rule 6), so this field deliberately sits outside rule 1.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The caller's own profile, with contact details UNMASKED.
   *
   * Not an exception to the privacy rules: masking protects a person from other
   * people, and the subject is entitled to see what the platform stores about
   * them. `notes` is still withheld — see the DTO.
   */
  async getMyProfile(userId: string): Promise<MyProfileResponse> {
    const person = await this.prisma.person.findUnique({ where: { userId } });
    // A user with no Person row is a real state (registration creates the User
    // first), so this is 404 with a specific message rather than a generic one.
    if (!person) throw new NotFoundException(ERRORS.profileNotFound);

    return this.toResponse(person, await this.isIdentityLocked(person.id));
  }

  /**
   * Updates the caller's own profile.
   *
   * Only the fields present in the body are touched, so a client that renders
   * one section of a form cannot blank the fields it never displayed.
   */
  async updateMyProfile(
    userId: string,
    dto: UpdateMyProfileDto,
    context: RequestContext,
  ): Promise<MyProfileResponse> {
    const before = await this.prisma.person.findUnique({ where: { userId } });
    if (!before) throw new NotFoundException(ERRORS.profileNotFound);

    const identityLocked = await this.isIdentityLocked(before.id);

    // Rule 1. Compared against the CURRENT value so that re-submitting an
    // unchanged form is not an error — a PATCH that echoes existing values back
    // is normal client behaviour and must not 409.
    const changesNationalId =
      dto.nationalId !== undefined && dto.nationalId !== before.nationalId;

    if (changesNationalId && identityLocked) {
      throw new ConflictException(ERRORS.sensitiveFieldLocked);
    }

    if (changesNationalId && dto.nationalId) {
      await this.assertNationalIdAvailable(dto.nationalId, before.id);
    }

    const data: Prisma.PersonUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.nationalId !== undefined) data.nationalId = dto.nationalId;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phoneNumber !== undefined) data.phoneNumber = dto.phoneNumber;
    if (dto.phoneIsPublic !== undefined) data.phoneIsPublic = dto.phoneIsPublic;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.locale !== undefined) data.locale = dto.locale;

    if (Object.keys(data).length === 0) {
      return this.toResponse(before, identityLocked);
    }

    const updated = await this.prisma.person.update({
      where: { id: before.id },
      data,
    });

    // BM-02 §46 requires profile changes to be audited. Attributed via `logAs`
    // because this route has no tenant scope — the actor is the user themselves.
    await this.audit.logAs(
      { userId, personId: before.id },
      {
        action: 'person.profile.updated',
        resourceType: 'Person',
        resourceId: before.id,
        before,
        after: updated,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    );

    return this.toResponse(updated, identityLocked);
  }

  // -------------------------------------------------------------------------
  //  internals
  // -------------------------------------------------------------------------

  /**
   * True when any ownership or occupancy for this person has been VERIFIED.
   *
   * Deliberately checks VERIFIED only. A PENDING claim has not been relied upon
   * by anyone yet, and freezing identity while a review is merely queued would
   * let a slow reviewer lock a user out of fixing their own typo.
   */
  private async isIdentityLocked(personId: string): Promise<boolean> {
    const [ownerships, occupancies] = await Promise.all([
      this.prisma.unitOwnership.count({
        where: { personId, verificationStatus: 'VERIFIED' },
      }),
      this.prisma.unitOccupancy.count({
        where: { personId, verificationStatus: 'VERIFIED' },
      }),
    ]);

    return ownerships > 0 || occupancies > 0;
  }

  /**
   * Refuses a national id already held by a different person.
   *
   * Not a database unique constraint on purpose: BM-02 §42 forbids automatic
   * merging and the column is nullable and historically dirty, so a hard
   * constraint would block legitimate imports. This check applies to the
   * self-service path, where a collision is far more likely to be a typo — or
   * an attempt to impersonate an existing owner — than a genuine duplicate.
   */
  private async assertNationalIdAvailable(
    nationalId: string,
    excludingPersonId: string,
  ): Promise<void> {
    const clash = await this.prisma.person.findFirst({
      where: { nationalId, id: { not: excludingPersonId } },
      select: { id: true },
    });

    if (clash) throw new ConflictException(ERRORS.nationalIdAlreadyUsed);
  }

  /** Maps a Person row onto the self-view response. */
  private toResponse(
    person: {
      id: string;
      userId: string | null;
      firstName: string;
      lastName: string;
      displayName: string | null;
      nationalId: string | null;
      email: string | null;
      phoneNumber: string | null;
      phoneIsPublic: boolean;
      avatarUrl: string | null;
      locale: string;
      createdAt: Date;
      updatedAt: Date;
    },
    identityLocked: boolean,
  ): MyProfileResponse {
    return {
      personId: person.id,
      // Non-null in practice: this row was found BY userId. The fallback keeps
      // the type honest rather than asserting with `!`.
      userId: person.userId ?? '',
      firstName: person.firstName,
      lastName: person.lastName,
      displayName: person.displayName,
      nationalId: person.nationalId,
      email: person.email,
      phoneNumber: person.phoneNumber,
      phoneIsPublic: person.phoneIsPublic,
      avatarUrl: person.avatarUrl,
      locale: person.locale,
      identityLocked,
      createdAt: person.createdAt,
      updatedAt: person.updatedAt,
    };
  }
}
