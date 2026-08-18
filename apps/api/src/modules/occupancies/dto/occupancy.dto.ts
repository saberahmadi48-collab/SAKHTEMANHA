import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { OccupancyKind } from '@prisma/client';

/**
 * Request/response shapes for unit-occupancy endpoints — BM-01 §20.
 *
 * OCCUPANCY IS NOT OWNERSHIP, and the separation is load-bearing rather than
 * tidy: BM-03 splits charges on exactly this line (fixed charges follow title,
 * consumption charges follow the person actually living there). Collapsing the
 * two would make a landlord's water bill unattributable.
 *
 * THE STRICTER RULE HERE: a unit may have only ONE occupancy at any instant.
 * Ownership permits overlap — that is joint title — but a flat cannot be both
 * VACANT and tenanted, so the EXCLUDE constraint keys on `unitId` alone.
 *
 * WHAT IS ABSENT CARRIES THE RULE, as in every other module:
 *
 *  - No `buildingId`. The tenant is proven by the guard from the URL.
 *  - No `unitId` on update — moving an occupancy to another unit is a data
 *    error, not an event.
 *  - No delete. A period ENDS; the row stays, because last winter's heating
 *    bill was split by who lived there then.
 */

/** Trims a string and returns undefined for blanks, so optional stays optional. */
const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? undefined : next;
};

/**
 * Opens an occupancy period.
 *
 * `personId` is CONDITIONALLY required: mandatory for every kind except VACANT,
 * and forbidden for VACANT. That pairing is enforced in the service and again
 * by the `unit_occupancies_person_matches_kind` CHECK — an "empty flat" that
 * names a resident is a contradiction the ledger cannot bill.
 */
export class CreateOccupancyDto {
  @IsUUID()
  unitId!: string;

  /** Required unless `kind` is VACANT, in which case it must be absent. */
  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsEnum(OccupancyKind)
  kind?: OccupancyKind;

  /**
   * Start of the half-open interval [periodStart, periodEnd).
   *
   * ISO-8601 string rather than a Date, for the same reason as ownership: the
   * column is `@db.Timestamptz` and the tstzrange EXCLUDE constraint reasons in
   * absolute instants, so a timezone-less local string would shift the boundary
   * by hours and land a move-out in the wrong billing month.
   */
  @IsDateString()
  periodStart!: string;

  /** Absent = current occupant (open-ended period). */
  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  /** Headcount drives per-person charges in BM-03. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  residentCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  leaseReference?: string;

  @IsOptional()
  @IsDateString()
  leaseStartsAt?: string;

  @IsOptional()
  @IsDateString()
  leaseEndsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trimmed)
  notes?: string;
}

/**
 * Corrects an OPEN occupancy period.
 *
 * The service refuses a closed one. No `personId` here either: changing who
 * lived somewhere during a past period rewrites history rather than recording a
 * move — a move is `moveOut` followed by a new period, or the `moveIn` endpoint
 * which does both atomically.
 */
export class UpdateOccupancyDto {
  @IsOptional()
  @IsEnum(OccupancyKind)
  kind?: OccupancyKind;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  residentCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  leaseReference?: string;

  @IsOptional()
  @IsDateString()
  leaseStartsAt?: string;

  @IsOptional()
  @IsDateString()
  leaseEndsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trimmed)
  notes?: string;
}

/**
 * Ends an open occupancy period.
 *
 * `leaveVacant` opens a VACANT period at the same instant, so the unit's
 * timeline has no hole. Defaulting it to false is deliberate: a move-out
 * immediately followed by a new tenant should not have a phantom vacancy
 * inserted between them.
 */
export class MoveOutDto {
  @IsOptional()
  @IsDateString()
  movedOutAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimmed)
  reason?: string;

  @IsOptional()
  @Type(() => Boolean)
  leaveVacant?: boolean;
}

/**
 * Moves someone in: closes whatever occupies the unit and opens the new period
 * at the SAME instant, in one transaction.
 *
 * Exists as its own endpoint rather than "close then create" from the client
 * because the EXCLUDE constraint makes the two-call version fail HALF the time —
 * create-then-close is rejected outright as an overlap, and close-then-create
 * leaves the unit with no occupancy if the second call never lands.
 */
export class MoveInDto {
  @IsUUID()
  unitId!: string;

  /** Required unless `kind` is VACANT. */
  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsEnum(OccupancyKind)
  kind?: OccupancyKind;

  /**
   * The instant occupancy changes hands. Both sides use it — half-open
   * intervals mean a period ending at T does not collide with one starting at
   * T, so there is neither a gap nor an overlap.
   */
  @IsDateString()
  movedInAt!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  residentCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  leaseReference?: string;

  @IsOptional()
  @IsDateString()
  leaseStartsAt?: string;

  @IsOptional()
  @IsDateString()
  leaseEndsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trimmed)
  notes?: string;
}

/** The occupant, as shown in an occupancy listing. Null for a VACANT period. */
export interface OccupantSummary {
  readonly personId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string | null;
}

/**
 * One occupancy period.
 *
 * `isCurrent` is DERIVED from the interval rather than stored — the same
 * decision as ownership and management terms, for the same reason: a stored
 * flag drifts the moment a period lapses and nothing has run to update it.
 */
export interface OccupancyResponse {
  readonly id: string;
  readonly buildingId: string;
  readonly unitId: string;
  readonly unitLabel: string | null;
  readonly occupant: OccupantSummary | null;
  readonly kind: OccupancyKind;
  readonly periodStart: Date;
  readonly periodEnd: Date | null;
  readonly isCurrent: boolean;
  readonly residentCount: number;
  readonly leaseReference: string | null;
  readonly leaseStartsAt: Date | null;
  readonly leaseEndsAt: Date | null;
  readonly notes: string | null;
  readonly createdAt: Date;
}

/** Both sides of a move, so the client can render the handover in one go. */
export interface OccupancyMoveResponse {
  readonly closed: OccupancyResponse | null;
  readonly opened: OccupancyResponse;
}
