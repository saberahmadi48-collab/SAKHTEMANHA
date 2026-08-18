import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { UnitKind, UnitStatus } from '@prisma/client';
import { toLatinDigits } from '@bops/i18n';

/**
 * Request/response shapes for unit endpoints (BM-01 §13–§17, §36).
 *
 * NO `buildingId` FIELD EXISTS ON ANY REQUEST DTO. The building comes from the
 * route's proven scope — §40 names `POST /api/units { "buildingId": "..." }`
 * as the exact anti-pattern to avoid, and `forbidNonWhitelisted` turns an
 * attempt to send one into a 400 rather than a cross-tenant write.
 *
 * NO OWNER OR RESIDENT FIELD EITHER. Who owns a unit and who lives in it are
 * temporal facts with date ranges (UnitOwnership / UnitOccupancy), owned by the
 * BM-02 endpoints. Accepting them here would collapse "sold in March" into a
 * column overwrite and destroy the pre-March ledger attribution (§14, §18).
 */

const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? undefined : next;
};

/** Persian digits → number; unparseable input survives so @IsInt can reject it. */
const numeric = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  const next = toLatinDigits(value.trim());
  if (next === '') return undefined;
  const parsed = Number(next);
  return Number.isFinite(parsed) ? parsed : value;
};

/**
 * Unit label ("12", "3B", "P-01", "SHOP-2").
 *
 * Persian digits are folded to Latin so "۱۲" and "12" cannot both exist in one
 * building — the column is citext, which handles case but not digit shape, so
 * without this the uniqueness constraint would be trivially bypassable.
 */
const label = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = toLatinDigits(value.trim()).replace(/\s+/g, ' ');
  return next === '' ? undefined : next;
};

export class CreateUnitDto {
  /** Unique within the building (§36). The DB enforces it; this normalises it. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Transform(label)
  label!: string;

  @IsOptional()
  @IsEnum(UnitKind)
  kind?: UnitKind;

  @IsOptional()
  @IsEnum(UnitStatus)
  status?: UnitStatus;

  /** Negative floors are basements/parking levels, hence the -20 lower bound. */
  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(-20)
  @Max(300)
  floor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  block?: string;

  /**
   * Area in m². Stored independently of any charge formula — §17 forbids
   * BM-01 from deciding how area participates in billing.
   */
  @IsOptional()
  @Transform(numeric)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  areaSqm?: number;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(50)
  bedroomCount?: number;

  /**
   * Share of common expenses (BM-03 apportionment input). Optional here: §17
   * says BM-01 stores the inputs and the finance module decides how to use them.
   */
  @IsOptional()
  @Transform(numeric)
  @IsNumber()
  @Min(0)
  @Max(1000)
  shareRatio?: number;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(50)
  parkingSpots?: number;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(50)
  storageUnits?: number;
}

/**
 * Fields a manager may change on an existing unit.
 *
 * `label` IS editable (a building may renumber its flats) but the id never
 * changes — §14: changing the owner, resident or number must not create a new
 * unit. Archiving is a separate endpoint, so `status` here cannot reach
 * ARCHIVED by accident.
 */
export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Transform(label)
  label?: string;

  @IsOptional()
  @IsEnum(UnitKind)
  kind?: UnitKind;

  @IsOptional()
  @IsEnum(UnitStatus)
  status?: Exclude<UnitStatus, 'ARCHIVED'>;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(-20)
  @Max(300)
  floor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  block?: string;

  @IsOptional()
  @Transform(numeric)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  areaSqm?: number;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(50)
  bedroomCount?: number;

  @IsOptional()
  @Transform(numeric)
  @IsNumber()
  @Min(0)
  @Max(1000)
  shareRatio?: number;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(50)
  parkingSpots?: number;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(50)
  storageUnits?: number;
}

/**
 * One floor's worth of units in an automatic-numbering plan.
 * `unitsOnFloor` × `floors` is what makes "24 units over 6 floors" one request
 * instead of 24.
 */
export class FloorPlanDto {
  @Transform(numeric)
  @IsInt()
  @Min(-20)
  @Max(300)
  floor!: number;

  @Transform(numeric)
  @IsInt()
  @Min(1)
  @Max(100)
  unitsOnFloor!: number;

  @IsOptional()
  @IsEnum(UnitKind)
  kind?: UnitKind;

  /** Applied to every unit generated for this floor when the plan omits it. */
  @IsOptional()
  @Transform(numeric)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  areaSqm?: number;
}

/**
 * Bulk unit creation from a floor plan (BM-01 §32 "define unit structure →
 * create units", §36 automatic numbering).
 *
 * Generates labels as `floor * 100 + index` — the numbering Iranian buildings
 * actually use (101, 102, 201, 202). A custom prefix covers parking and
 * storage ("P-01", "S-03").
 */
export class GenerateUnitsDto {
  @IsArray()
  @ArrayMinSize(1)
  // Bounded so one request cannot ask for a hundred thousand rows in a single
  // transaction and hold a connection long enough to starve the pool.
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => FloorPlanDto)
  floors!: FloorPlanDto[];

  /**
   * Optional label prefix. With "P" the generated labels are "P-101"… — used
   * for parking and storage levels, which do not follow flat numbering.
   */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Transform(({ value }) =>
    typeof value === 'string'
      ? toLatinDigits(value.trim()).toUpperCase() || undefined
      : value,
  )
  labelPrefix?: string;

  /** Default kind for floors that do not state one. */
  @IsOptional()
  @IsEnum(UnitKind)
  defaultKind?: UnitKind;
}

export interface UnitResponse {
  readonly id: string;
  readonly buildingId: string;
  readonly label: string;
  readonly kind: UnitKind;
  readonly status: UnitStatus;
  readonly floor: number | null;
  readonly block: string | null;
  readonly areaSqm: number | null;
  readonly bedroomCount: number | null;
  readonly shareRatio: number | null;
  readonly parkingSpots: number;
  readonly storageUnits: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Result of a bulk generation: what was created and what was skipped. */
export interface GenerateUnitsResponse {
  readonly created: readonly UnitResponse[];
  /**
   * Labels that already existed and were left untouched. Reported rather than
   * silently overwritten — overwriting would rewrite a unit that already has
   * ownership and ledger history attached to it (§14).
   */
  readonly skipped: readonly string[];
}
