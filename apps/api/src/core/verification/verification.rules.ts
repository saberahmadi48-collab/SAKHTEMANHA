import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { ERRORS } from '@bops/i18n';

import type {
  DecideVerificationDto,
  VerificationSummary,
} from './verification.dto';

/**
 * The rules a verification decision must satisfy — BM-02 §31/§32.
 *
 * Extracted from the two services so ownership and occupancy cannot drift.
 * These are pure functions over plain data: they take no Prisma client and no
 * request, which is what makes them directly testable and what keeps the same
 * judgement applying to both relationships.
 *
 * TWO RULES LIVE HERE, AND BOTH ARE ABOUT KEEPING AN ATTESTATION HONEST:
 *
 *  1. NOBODY VERIFIES THEMSELVES. A manager who also owns flat 12 must not
 *     approve their own title claim. Holding VERIFICATION_MANAGE says "this
 *     person is trusted to check documents", not "this person's own claims need
 *     no checking" — and self-approval is precisely the case where an
 *     independent reviewer matters most.
 *
 *  2. A REJECTION MUST SAY WHY. An unexplained rejection cannot be appealed or
 *     corrected, which turns a review step into an opaque veto.
 */

/** The verification columns every reviewable row carries. */
export interface VerifiableRow {
  readonly personId: string | null;
  readonly verificationStatus: VerificationStatus;
  readonly verifiedAt: Date | null;
  readonly verifiedByPersonId: string | null;
  readonly verificationNote: string | null;
}

/** The database patch a decision produces. */
export interface VerificationPatch {
  readonly verificationStatus: VerificationStatus;
  readonly verifiedAt: Date | null;
  readonly verifiedByPersonId: string | null;
  readonly verificationNote: string | null;
}

/**
 * Validates a decision and returns the columns to write.
 *
 * `reviewerPersonId` comes from the caller's proven scope, never from the body.
 * Passing null is treated as "no person on file for this reviewer" and is
 * rejected: an attestation nobody is accountable for is not an attestation.
 */
export function decideVerification(
  row: VerifiableRow,
  dto: DecideVerificationDto,
  reviewerPersonId: string | null,
): VerificationPatch {
  if (!reviewerPersonId) {
    throw new BadRequestException(ERRORS.personProfileRequired);
  }

  // Rule 1. Compared on personId rather than userId because the relationship
  // row points at a Person — a reviewer with a second account would otherwise
  // slip through a userId check.
  if (row.personId && row.personId === reviewerPersonId) {
    throw new ForbiddenException(ERRORS.cannotVerifyOwnRecord);
  }

  // Rule 2.
  if (dto.status === 'REJECTED' && !dto.note) {
    throw new BadRequestException(ERRORS.verificationReasonRequired);
  }

  // Only a settled decision stamps a reviewer and a time. Moving a row BACK to
  // PENDING deliberately clears both: leaving a stale `verifiedAt` on a row
  // awaiting review would make an unreviewed claim look approved to anything
  // that checks the timestamp instead of the status.
  const settled = dto.status === 'VERIFIED' || dto.status === 'REJECTED';

  return {
    verificationStatus: dto.status,
    verifiedAt: settled ? new Date() : null,
    verifiedByPersonId: settled ? reviewerPersonId : null,
    // The note is kept even when reopening, because "why was this sent back"
    // is exactly what the next reviewer needs.
    verificationNote: dto.note ?? null,
  };
}

/** Maps the verification columns onto the response summary. */
export function toVerificationSummary(row: VerifiableRow): VerificationSummary {
  return {
    status: row.verificationStatus,
    verifiedAt: row.verifiedAt,
    verifiedByPersonId: row.verifiedByPersonId,
    note: row.verificationNote,
  };
}
