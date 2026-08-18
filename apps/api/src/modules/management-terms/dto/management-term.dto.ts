import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  HandoverStatus,
  ManagementTermStatus,
  type BuildingRole,
} from '@prisma/client';

/**
 * Request/response shapes for the management-term endpoints — BM-01 §25/§26,
 * the API surface of BM-00 rule 1 ("the building is permanent, the manager is
 * temporary").
 *
 * WHAT IS ABSENT CARRIES THE RULE, exactly as in the membership DTOs:
 *
 *  - No `buildingId` anywhere. The building is proven by the guard from the URL
 *    before a handler runs; a body that could name its own building would let a
 *    manager of building A schedule themselves a term on building B.
 *  - No `termNumber`. It is assigned server-side as `max(termNumber) + 1` per
 *    building, so a client cannot fabricate "term 1" and make a later term look
 *    like it predates the real first one in every governance document.
 *  - No `status` on create or update. Status moves only through the explicit
 *    `activate` / `terminate` endpoints, each of which has its own permission
 *    and its own audit action. A freely settable status would let a routine
 *    edit hand someone authority with no recorded act of granting it.
 */

/** Trims a string and returns undefined for blanks, so optional stays optional. */
const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? undefined : next;
};

/**
 * Schedules a new management term.
 *
 * Created as SCHEDULED, never ACTIVE: electing a board and that board taking
 * office are two different events, and §26 expects the gap between them to be
 * representable. `activate` is the separate, audited act of taking office.
 */
export class CreateManagementTermDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  title?: string;

  /**
   * Start of the half-open interval [startsAt, endsAt).
   *
   * ISO-8601 string rather than a Date: `@db.Timestamptz` columns and the
   * tstzrange EXCLUDE constraint both reason in absolute instants, and a
   * timezone-less local string would land in whatever zone the server happens
   * to run in — silently shifting the term boundary by hours.
   */
  @IsDateString()
  startsAt!: string;

  /** Null/absent = open-ended term (still bounded by the overlap constraint). */
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  /**
   * The person who will hold the manager seat. Optional because §26 allows a
   * term to be prepared before an election concludes (BM-06).
   *
   * The service refuses a person who is not already a member of this building:
   * a manager who is a stranger to the building would be authority granted from
   * outside the tenant.
   */
  @IsOptional()
  @IsUUID()
  managerPersonId?: string;

  /**
   * Links this term to the one it takes custody from, forming an explicit chain
   * (`previousTermId`). Optional — the very first term of a building has no
   * predecessor.
   */
  @IsOptional()
  @IsUUID()
  previousTermId?: string;
}

/**
 * Edits a term that has not closed yet.
 *
 * Only SCHEDULED and ACTIVE terms are editable; the service refuses COMPLETED
 * and TERMINATED ones. Editing a closed term would rewrite the record of who
 * governed when, which is the one thing R2 forbids.
 */
export class UpdateManagementTermDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  title?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  /**
   * Pass `clearEndsAt: true` to make a bounded term open-ended — a plain
   * omitted field cannot express "set this to null", and overloading `endsAt`
   * with an empty string would be ambiguous with a validation failure.
   */
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  clearEndsAt?: boolean;

  @IsOptional()
  @IsUUID()
  managerPersonId?: string;

  @IsOptional()
  @IsEnum(HandoverStatus)
  handoverStatus?: HandoverStatus;
}

/**
 * Puts a SCHEDULED term into force.
 *
 * This is the moment authority actually transfers, so it is its own endpoint
 * with its own permission and audit action rather than a status field on an
 * update.
 */
export class ActivateManagementTermDto {
  /**
   * Closes the currently ACTIVE term (as COMPLETED) in the same transaction.
   *
   * Defaults to false and the service then REFUSES to activate while another
   * term governs. Making the handover explicit is the point: silently ending
   * someone's mandate as a side effect of activating another is precisely the
   * kind of untraceable authority change §25 is written against.
   */
  @IsOptional()
  @IsBoolean()
  closeActiveTerm?: boolean;
}

/**
 * Ends a term early. `reason` is REQUIRED — R2 says we record why rather than
 * delete, and a termination with no stated cause is an unexplained removal of
 * an elected officeholder.
 */
export class TerminateManagementTermDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(trimmed)
  reason!: string;
}

/** Completes a term normally (mandate ran its course). */
export class CompleteManagementTermDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimmed)
  note?: string;
}

/** The manager of a term, as shown in a term listing. */
export interface TermManagerSummary {
  readonly personId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string | null;
  /** Building role the manager currently holds, if they are still a member. */
  readonly buildingRole: BuildingRole | null;
}

/**
 * One management term.
 *
 * `isCurrent` is DERIVED from status plus the interval rather than stored:
 * a term whose `endsAt` passed last night is no longer current even though a
 * nightly job has not yet flipped its status, and authorization already resolves
 * it that way in ScopeService. Returning a stored flag here would let the UI
 * disagree with the guard about who is in charge.
 */
export interface ManagementTermResponse {
  readonly id: string;
  readonly buildingId: string;
  readonly termNumber: number;
  readonly title: string | null;
  readonly status: ManagementTermStatus;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly isCurrent: boolean;
  readonly manager: TermManagerSummary | null;
  readonly handoverStatus: HandoverStatus;
  readonly handoverCompletedAt: Date | null;
  readonly previousTermId: string | null;
  readonly terminationReason: string | null;
  readonly terminatedAt: Date | null;
  readonly createdAt: Date;
}
