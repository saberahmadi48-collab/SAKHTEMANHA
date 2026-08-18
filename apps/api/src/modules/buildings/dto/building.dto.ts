import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  BuildingStatus,
  ChargeCycle,
  LocationPrecision,
} from '@prisma/client';
import { toLatinDigits } from '@bops/i18n';

import { IsIranianPostalCode } from '../../../common/validators/iranian.validators';

/**
 * Request/response shapes for the building endpoints (BM-01 §6, §9, §10, §11).
 *
 * THREE RULES SHAPE THIS FILE:
 *
 *  1. NO `organizationId` FIELD ANYWHERE. The owning organization comes from
 *     the route's proven scope, never the body — BM-01 §40 names this exact
 *     anti-pattern ("POST /api/units { buildingId } without authorization
 *     validation") as the wrong way to do it.
 *
 *  2. ONLY NAME + CITY + ADDRESS LINE ARE REQUIRED. §9 and §32 explicitly
 *     require onboarding to work with incomplete data and to support drafts, so
 *     floors, year, coordinates and facilities are all optional.
 *
 *  3. NUMBERS ARRIVE AS PERSIAN DIGITS. A Persian-first UI sends "۱۲" for the
 *     floor count and `Number("۱۲")` is NaN, so every numeric field is
 *     normalised through `toLatinDigits` before validation rather than after.
 */

/** Trims a string and returns undefined for blanks, so optional stays optional. */
const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? undefined : next;
};

/**
 * Converts Persian/Arabic digits to a real number.
 *
 * Returns the ORIGINAL value when it cannot be parsed, so @IsInt produces the
 * Persian "must be a number" message. Returning undefined instead would turn a
 * typo into a silently missing field.
 */
const numeric = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  const next = toLatinDigits(value.trim());
  if (next === '') return undefined;
  const parsed = Number(next);
  return Number.isFinite(parsed) ? parsed : value;
};

/** Building code: ASCII, URL/document safe. Same reasoning as organization slug. */
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Postal address of a building (BM-01 §10).
 *
 * Nested rather than flattened onto the building so the same shape can be
 * reused by service providers (BM-05) and billing (BM-04) — the schema already
 * models Address as its own table for that reason.
 */
export class BuildingAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(2)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || undefined : value,
  )
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trimmed)
  province?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(trimmed)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trimmed)
  district?: string;

  /** Free-form street line — Iranian addresses do not decompose cleanly. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  @Transform(trimmed)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  @Transform(trimmed)
  line2?: string;

  /** Validated with Iran Post's own rule, including the forbidden digits. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? toLatinDigits(value.trim()).replace(/[\s-]/g, '') || undefined
      : value,
  )
  @IsIranianPostalCode()
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(trimmed)
  plaqueNumber?: string;

  @IsOptional()
  @Transform(numeric)
  @IsNumber()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Transform(numeric)
  @IsNumber()
  @IsLongitude()
  longitude?: number;

  /**
   * The CEILING on how precisely the API may ever reveal this location
   * (BM-01 §11/§12). Defaults to APPROXIMATE in the schema — opting IN to
   * exposure is the safe direction, and the server downgrades further based on
   * the caller's role regardless of what is set here.
   */
  @IsOptional()
  @IsEnum(LocationPrecision)
  locationPrecision?: LocationPrecision;
}

export class CreateBuildingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(trimmed)
  name!: string;

  /**
   * Optional: the service generates `BLD-000123` style codes when omitted
   * (BM-01 §37). Unique per organization, not globally — two management
   * companies may both use "A1".
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(({ value }) =>
    typeof value === 'string'
      ? toLatinDigits(value.trim()).toUpperCase() || undefined
      : value,
  )
  @Matches(CODE_PATTERN)
  code?: string;

  @ValidateNested()
  @Type(() => BuildingAddressDto)
  address!: BuildingAddressDto;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(1)
  @Max(300)
  floorCount?: number;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(20)
  basementCount?: number;

  /**
   * Declared unit count. NOT authoritative — the real count is `units.length`.
   * It exists so a draft building can state "24 units" before any unit row is
   * created, which §32 requires the onboarding flow to support.
   */
  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(1)
  @Max(10_000)
  totalUnitCount?: number;

  /**
   * Gregorian year. Persian years (۱۴۰۳) are accepted digit-wise by the
   * transform but would fall outside this range and be rejected — the client
   * converts the calendar, since storing a mix of Jalali and Gregorian years in
   * one column would make "buildings older than 20 years" unanswerable.
   */
  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(1800)
  @Max(2200)
  constructionYear?: number;

  @IsOptional()
  @Transform(numeric)
  @IsNumber()
  @Min(0)
  totalAreaSqm?: number;

  @IsOptional()
  @IsBoolean()
  hasElevator?: boolean;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(50)
  elevatorCount?: number;

  @IsOptional()
  @IsBoolean()
  hasParking?: boolean;

  @IsOptional()
  @IsBoolean()
  hasCentralHeating?: boolean;

  /** Inherited from the organization when omitted (BM-01 §28, §29). */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Transform(trimmed)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trimmed)
  timeZone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimmed)
  locale?: string;

  /**
   * Explicit override for the duplicate-building warning (BM-01 §35).
   *
   * §35 requires the system to WARN about a similar existing building but
   * forbids automatic merging, so the flow is: first attempt returns 409 with
   * the candidates, the user confirms, the client retries with this flag. It is
   * never set by default — that would silently disable the check.
   */
  @IsOptional()
  @IsBoolean()
  confirmPossibleDuplicate?: boolean;
}

/**
 * Fields a manager may change after creation.
 *
 * `code` is ABSENT: §6 says the building code "should not change casually" and
 * it appears in issued documents. `status` is absent too — lifecycle
 * transitions are their own audited endpoint (§8), not a profile edit.
 */
export class UpdateBuildingDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(trimmed)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BuildingAddressDto)
  address?: BuildingAddressDto;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(1)
  @Max(300)
  floorCount?: number;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(20)
  basementCount?: number;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(1)
  @Max(10_000)
  totalUnitCount?: number;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(1800)
  @Max(2200)
  constructionYear?: number;

  @IsOptional()
  @Transform(numeric)
  @IsNumber()
  @Min(0)
  totalAreaSqm?: number;

  @IsOptional()
  @IsBoolean()
  hasElevator?: boolean;

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(50)
  elevatorCount?: number;

  @IsOptional()
  @IsBoolean()
  hasParking?: boolean;

  @IsOptional()
  @IsBoolean()
  hasCentralHeating?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Transform(trimmed)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trimmed)
  timeZone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimmed)
  locale?: string;
}

/**
 * Lifecycle transition (BM-01 §8).
 *
 * A dedicated endpoint rather than a `status` field on the update DTO, so every
 * transition produces its own audit action and can carry a reason.
 */
export class ChangeBuildingStatusDto {
  @IsEnum(BuildingStatus)
  status!: BuildingStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimmed)
  reason?: string;
}

/** Operational settings for one building (BM-01 §27). */
export class UpdateBuildingSettingsDto {
  @IsOptional()
  @IsEnum(ChargeCycle)
  chargeCycle?: ChargeCycle;

  /**
   * Capped at 28 so the due date exists in every month — a "31st" due day
   * silently becomes "never" in February.
   */
  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(1)
  @Max(28)
  chargeDueDay?: number;

  @IsOptional()
  @IsBoolean()
  notifyByEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyBySms?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyInApp?: boolean;

  @IsOptional()
  @IsBoolean()
  showResidentContacts?: boolean;

  @IsOptional()
  @IsBoolean()
  showUnitOwners?: boolean;

  @IsOptional()
  @IsBoolean()
  discoverableByProviders?: boolean;
}

/** Address as returned to a client, after location-privacy filtering. */
export interface BuildingAddressResponse {
  readonly id: string;
  readonly countryCode: string;
  readonly province: string | null;
  readonly city: string;
  readonly district: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly postalCode: string | null;
  readonly plaqueNumber: string | null;
  /**
   * Null whenever the caller is not entitled to precise coordinates. The value
   * is dropped SERVER-SIDE (BM-01 §12 forbids relying on the client to hide
   * it), so an unauthorised caller never receives the number at all.
   */
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly locationPrecision: LocationPrecision;
}

export interface BuildingSettingsResponse {
  readonly chargeCycle: ChargeCycle;
  readonly chargeDueDay: number;
  readonly notifyByEmail: boolean;
  readonly notifyBySms: boolean;
  readonly notifyInApp: boolean;
  readonly showResidentContacts: boolean;
  readonly showUnitOwners: boolean;
  readonly discoverableByProviders: boolean;
}

export interface BuildingResponse {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly status: BuildingStatus;
  readonly floorCount: number | null;
  readonly basementCount: number | null;
  readonly totalUnitCount: number | null;
  readonly constructionYear: number | null;
  readonly totalAreaSqm: number | null;
  readonly hasElevator: boolean;
  readonly elevatorCount: number;
  readonly hasParking: boolean;
  readonly hasCentralHeating: boolean;
  readonly currency: string;
  readonly timeZone: string;
  readonly locale: string;
  readonly address: BuildingAddressResponse | null;
  readonly settings: BuildingSettingsResponse | null;
  /** Live count of non-archived units — the authoritative one. */
  readonly unitCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** List entry: enough to render a card, without the full address or settings. */
export interface BuildingSummaryResponse {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly status: BuildingStatus;
  readonly city: string | null;
  readonly unitCount: number;
}

/**
 * A building that looks like the one being created (BM-01 §35).
 * Returned with a 409 so the client can show "a similar building exists" and
 * offer to confirm — never merged automatically.
 */
export interface DuplicateBuildingCandidate {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly city: string | null;
  readonly line1: string | null;
  readonly postalCode: string | null;
  /** Why this row was flagged: postal code, coordinates, or name+address. */
  readonly matchedOn: readonly string[];
}
