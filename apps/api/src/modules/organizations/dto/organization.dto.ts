import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { OrganizationStatus, OrganizationType } from '@prisma/client';

import { IsIranianMobile, normalizeIranianMobile } from '../../../common/validators/iranian.validators';

/**
 * Request/response shapes for the organization endpoints (BM-01 §4, §5).
 *
 * NO ROLE OR MEMBERSHIP FIELD EXISTS HERE BY DESIGN. The creator's ORG_OWNER
 * membership is minted server-side inside the same transaction as the
 * organization; letting the body carry a role would be exactly the
 * client-supplied tenancy BM-00 rule 8 forbids, and `forbidNonWhitelisted`
 * turns any attempt to smuggle one into a 400.
 */

/** Trims a string and returns undefined for blanks, so optional stays optional. */
const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? undefined : next;
};

/**
 * URL-safe slug: lowercase letters, digits and single hyphens.
 *
 * Deliberately ASCII-only even though the platform is Persian-first. The slug
 * appears in URLs and in the `@db.Citext` unique index; allowing Persian text
 * would make two visually identical orgs differ by an invisible ZWNJ and defeat
 * the uniqueness guarantee. The DISPLAY name carries the Persian.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateOrganizationDto {
  /** Persian display name — what every screen actually shows. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(trimmed)
  name!: string;

  /**
   * Stable public identifier used in URLs. Lowercased on the way in so
   * "Tehran-Towers" and "tehran-towers" cannot both be created — the citext
   * column would reject the second, but only after a confusing round trip.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(60)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || undefined : value,
  )
  @Matches(SLUG_PATTERN)
  slug!: string;

  /** BM-01 §4. Defaults to INDIVIDUAL so self-managed buildings need no choice. */
  @IsOptional()
  @IsEnum(OrganizationType)
  type?: OrganizationType;

  @IsOptional()
  @MaxLength(200)
  @Transform(trimmed)
  legalName?: string;

  @IsOptional()
  @MaxLength(50)
  @Transform(trimmed)
  taxIdentifier?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || undefined : value,
  )
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const next = value.trim();
    if (next === '') return undefined;
    // Unnormalisable input is passed through so @IsIranianMobile rejects it
    // with the Persian message, rather than silently becoming "not provided".
    return normalizeIranianMobile(next) ?? next;
  })
  @IsIranianMobile()
  contactPhone?: string;

  /**
   * Locale / currency / timezone defaults inherited by every building created
   * under this organization (BM-01 §28, §29). Kept configurable rather than
   * hard-coded: §29 explicitly forbids baking IRR into domain logic.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimmed)
  defaultLocale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Transform(trimmed)
  defaultCurrency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trimmed)
  defaultTimeZone?: string;
}

/**
 * Fields an org admin may change after creation.
 *
 * `slug` is ABSENT on purpose: it is a public identifier that lands in URLs and
 * documents, so renaming it silently breaks every saved link. A rename needs a
 * deliberate redirect story, which BM-01 does not own.
 */
export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(trimmed)
  name?: string;

  @IsOptional()
  @IsEnum(OrganizationType)
  type?: OrganizationType;

  /**
   * ARCHIVED is not reachable through this field — archiving is a separate,
   * audited endpoint. Allowing it here would let a routine profile edit retire
   * a tenant with no distinct audit action to point at (R2).
   */
  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: Exclude<OrganizationStatus, 'ARCHIVED'>;

  @IsOptional()
  @MaxLength(200)
  @Transform(trimmed)
  legalName?: string;

  @IsOptional()
  @MaxLength(50)
  @Transform(trimmed)
  taxIdentifier?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || undefined : value,
  )
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const next = value.trim();
    if (next === '') return undefined;
    return normalizeIranianMobile(next) ?? next;
  })
  @IsIranianMobile()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimmed)
  defaultLocale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Transform(trimmed)
  defaultCurrency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trimmed)
  defaultTimeZone?: string;
}

/**
 * Organization as returned to a client.
 *
 * Assembled field by field rather than spread from the entity, so a sensitive
 * column added to the model later cannot leak into a response by default.
 */
export interface OrganizationResponse {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly type: OrganizationType;
  readonly status: OrganizationStatus;
  readonly legalName: string | null;
  readonly taxIdentifier: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly defaultLocale: string;
  readonly defaultCurrency: string;
  readonly defaultTimeZone: string;
  readonly buildingCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** One entry of the caller's organization list, with their roles in it. */
export interface OrganizationSummaryResponse {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly type: OrganizationType;
  readonly status: OrganizationStatus;
  readonly buildingCount: number;
  readonly roles: readonly string[];
}
