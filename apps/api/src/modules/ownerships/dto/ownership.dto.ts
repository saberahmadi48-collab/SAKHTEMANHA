import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Request/response shapes for unit-ownership endpoints — BM-01 §18/§19, the
 * API surface of R2 ("record history, never overwrite it").
 *
 * THE CENTRAL IDEA: A SALE IS NOT AN EDIT. Transferring a unit does not change
 * the owner field on a row — it CLOSES the seller's period and OPENS the
 * buyer's. That is why there is a `transfer` endpoint and why `close` exists at
 * all: a charge raised last spring must stay attributable to whoever actually
 * held title that month, long after the unit changed hands (BM-03).
 *
 * WHAT IS ABSENT CARRIES THE RULE, as in the term and membership DTOs:
 *
 *  - No `buildingId`. The tenant is proven by the guard from the URL before any
 *    handler runs; a body naming its own building would let a manager of
 *    building A write ownership rows into building B.
 *  - No `unitId` on update/close. The unit is fixed at creation — "move this
 *    title to another unit" is not a real-world event, it is a data error.
 *  - No delete anywhere. A wrongly entered period is CORRECTED while open or
 *    closed with a note; erasing it would erase the audit trail a later
 *    ownership dispute is settled with.
 */

/** Trims a string and returns undefined for blanks, so optional stays optional. */
const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? undefined : next;
};

/**
 * Opens a title period for a person on a unit.
 *
 * Joint ownership is expressed by opening SEVERAL overlapping periods on the
 * same unit for DIFFERENT people — legitimate, and bounded by the "active
 * shares sum to 100" rule in the service. The database only forbids the SAME
 * person holding two overlapping periods on the same unit.
 */
export class CreateOwnershipDto {
  @IsUUID()
  unitId!: string;

  /**
   * The title holder. Must already be a member of this building — an owner who
   * is a stranger to the tenant would be a person row reachable from outside
   * the scope the guard proved.
   */
  @IsUUID()
  personId!: string;

  /**
   * Start of the half-open interval [periodStart, periodEnd).
   *
   * ISO-8601 string rather than a Date: the column is `@db.Timestamptz` and the
   * tstzrange EXCLUDE constraint reasons in absolute instants. A timezone-less
   * local string would land in whatever zone the server runs in and silently
   * shift the boundary by hours — enough to make a month-end handover land in
   * the wrong billing period.
   */
  @IsDateString()
  periodStart!: string;

  /** Absent = current owner (open-ended period). */
  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  /**
   * Share of title, 0 < share <= 100. Defaults to 100 (sole ownership).
   *
   * Declared as a number and coerced with `@Type`, because JSON sends `50` and
   * `"50"` interchangeably depending on the client; the DB column is
   * Decimal(6,3) so thirds of a percent survive.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100)
  sharePercent?: number;

  /**
   * The owner of record who receives statutory notices. The service enforces
   * that a unit has at most one primary owner at any instant — two people both
   * believing they are the notified party is how legal notice gets missed.
   */
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  /** Provenance — deed number, contract reference. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  titleReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  acquiredVia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trimmed)
  notes?: string;
}

/**
 * Corrects an OPEN title period.
 *
 * The service refuses a closed one: once a period has ended it is history, and
 * history that can be edited settles no dispute (R2). Note there is no
 * `personId` here either — reassigning a period to a different person would
 * rewrite who owned the unit during that time rather than record a transfer.
 */
export class UpdateOwnershipDto {
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100)
  sharePercent?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  titleReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  acquiredVia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trimmed)
  notes?: string;
}

/** Ends an open title period at a given instant (default: now). */
export class CloseOwnershipDto {
  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimmed)
  reason?: string;
}

/**
 * Transfers a unit: closes the seller's period and opens the buyer's at the
 * SAME instant, in one transaction.
 *
 * Exists as its own endpoint rather than "close then create" from the client,
 * because a client doing it in two calls can crash between them and leave the
 * unit with no owner — or, worse, succeed at the create and fail at the close,
 * leaving two simultaneous title holders the ledger cannot split.
 */
export class TransferOwnershipDto {
  @IsUUID()
  unitId!: string;

  /** The incoming owner. Must already be a member of the building. */
  @IsUUID()
  toPersonId!: string;

  /**
   * The instant title passes. Both the closing and the opening period use it,
   * which is exactly why the intervals are half-open: `[)` means a period
   * ending at T does not collide with one starting at T, so a clean handover is
   * expressible without a one-second gap.
   */
  @IsDateString()
  transferredAt!: string;

  /**
   * Restricts the transfer to ONE seller's period. Omit to close every active
   * period on the unit — the normal case when jointly held title is sold whole.
   */
  @IsOptional()
  @IsUUID()
  fromPersonId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100)
  sharePercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  titleReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  acquiredVia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trimmed)
  notes?: string;
}

/** The title holder, as shown in an ownership listing. */
export interface OwnerSummary {
  readonly personId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string | null;
}

/**
 * One title period.
 *
 * `isCurrent` is DERIVED from the interval rather than stored, the same way
 * ManagementTermResponse derives it: a period whose `periodEnd` passed last
 * night is no longer current even though nothing has run to mark it, and
 * anything that reads a stored flag would disagree with the queries that
 * compute it.
 */
export interface OwnershipResponse {
  readonly id: string;
  readonly buildingId: string;
  readonly unitId: string;
  readonly unitLabel: string | null;
  readonly owner: OwnerSummary;
  readonly periodStart: Date;
  readonly periodEnd: Date | null;
  readonly isCurrent: boolean;
  /** Serialised as a number; the column is Decimal(6,3). */
  readonly sharePercent: number;
  readonly isPrimary: boolean;
  readonly titleReference: string | null;
  readonly acquiredVia: string | null;
  readonly notes: string | null;
  readonly createdAt: Date;
}

/** Both sides of a transfer, so the client can render the handover in one go. */
export interface OwnershipTransferResponse {
  readonly closed: readonly OwnershipResponse[];
  readonly opened: OwnershipResponse;
}
