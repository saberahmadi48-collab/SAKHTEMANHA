import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  BuildingRole,
  InvitationStatus,
  OrganizationRole,
} from '@prisma/client';

import {
  IsIranianMobile,
  normalizeIranianMobile,
} from '../../../common/validators/iranian.validators';

/**
 * Request/response shapes for the invitation endpoints (BM-01 §33, §34).
 *
 * THE FIELD THAT IS ABSENT IS THE POINT: no DTO here carries `organizationId`
 * or `buildingId`. The tenant comes exclusively from the route's proven
 * RequestScope, so an inviter cannot mint an invitation into a building they do
 * not administer by editing a JSON body. `forbidNonWhitelisted` turns any
 * attempt to smuggle one in into a Persian 400 before the handler runs.
 *
 * The same applies in the other direction on acceptance: AcceptInvitationDto
 * carries ONLY a token. The invitee never states which building or role they
 * are joining — the server reads both from the stored invitation row. That is
 * BM-00 rule 8 ("authorization is never client-supplied") applied to the one
 * flow where an untrusted actor legitimately creates a membership.
 */

/** Trims a string and returns undefined for blanks, so optional stays optional. */
const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? undefined : next;
};

/**
 * Invites a person into the ORGANIZATION tier.
 *
 * `role` is an OrganizationRole and nothing else — a caller cannot pass
 * `BUILDING_MANAGER` here and have it silently land on a building membership,
 * because the two tiers have separate DTOs and separate endpoints.
 */
export class CreateOrganizationInvitationDto {
  @IsEnum(OrganizationRole)
  role!: OrganizationRole;

  /**
   * Delivery target. At least one of email/phoneNumber is required — validated
   * in the service rather than by a decorator, because class-validator cannot
   * express "at least one of these two" without a custom constraint, and a
   * silently-undeliverable invitation is worse than a 400.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || undefined : value,
  )
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const next = value.trim();
    if (next === '') return undefined;
    // Unnormalisable input passes through so @IsIranianMobile rejects it with
    // the Persian message instead of it becoming "not provided".
    return normalizeIranianMobile(next) ?? next;
  })
  @IsIranianMobile()
  phoneNumber?: string;

  /** Pre-links an existing Person when inviting someone already on file. */
  @IsOptional()
  @IsUUID()
  personId?: string;

  /** Free-text note shown in the invitation. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimmed)
  message?: string;

  /**
   * Validity window. Bounded at both ends deliberately: a 0-day invitation is
   * unusable, and an unbounded one is a permanent credential sitting in an
   * inbox. Defaults to INVITATION_DEFAULT_TTL_DAYS in the service.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  expiresInDays?: number;
}

/**
 * Invites a person into a specific BUILDING, optionally bound to one unit.
 *
 * `unitId` is validated as a UUID here but its OWNERSHIP is re-checked
 * server-side against the scoped building — a unit id from another building is
 * rejected in the service, not trusted because it parsed.
 */
export class CreateBuildingInvitationDto {
  @IsEnum(BuildingRole)
  role!: BuildingRole;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || undefined : value,
  )
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const next = value.trim();
    if (next === '') return undefined;
    return normalizeIranianMobile(next) ?? next;
  })
  @IsIranianMobile()
  phoneNumber?: string;

  /** Binds the invitation to one unit ("the resident of flat 12"). */
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimmed)
  message?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  expiresInDays?: number;
}

/**
 * Redeems an invitation.
 *
 * ONE FIELD, ON PURPOSE. Scope and role are read from the stored row; the
 * invitee supplies proof of the invitation and nothing more.
 */
export class AcceptInvitationDto {
  @IsString()
  @MaxLength(200)
  @Transform(trimmed)
  token!: string;
}

/**
 * Invitation as returned to a client.
 *
 * `token` IS DELIBERATELY NOT HERE. Only the sha256 hash is stored, and the raw
 * token exists exactly once — in the response to `create`, for delivery. A list
 * or detail endpoint that echoed it would turn read access to the invitation
 * list into the ability to accept every pending invitation in the tenant.
 *
 * Contact details are masked (BM-00 rule 6): the member list shows who was
 * invited without handing every MEMBER_READ holder a harvestable address book.
 */
export interface InvitationResponse {
  readonly id: string;
  readonly organizationId: string;
  readonly buildingId: string | null;
  readonly unitId: string | null;
  /** Masked — e.g. "a***@example.com". */
  readonly email: string | null;
  /** Masked — e.g. "0912***4567". */
  readonly phoneNumber: string | null;
  readonly organizationRole: OrganizationRole | null;
  readonly buildingRole: BuildingRole | null;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly message: string | null;
  readonly createdAt: Date;
}

/**
 * Returned once, at creation. Carries the raw token so the caller can deliver
 * it (BM-07 will send the message; until then the client shows a copyable link).
 *
 * This is the ONLY shape in the system that exposes the token, and it is never
 * persisted in this form.
 */
export interface CreatedInvitationResponse {
  readonly invitation: InvitationResponse;
  /** Raw token — deliver it, never store or log it. */
  readonly token: string;
}

/** Result of redeeming an invitation: what the caller now has access to. */
export interface AcceptInvitationResponse {
  readonly organizationId: string;
  readonly buildingId: string | null;
  readonly unitId: string | null;
  readonly organizationRole: OrganizationRole | null;
  readonly buildingRole: BuildingRole | null;
}

/**
 * Preview of an invitation, shown on the acceptance screen BEFORE the invitee
 * commits — and before they necessarily have an account.
 *
 * Carries names, never ids: the recipient of a leaked link learns "you were
 * invited to «برج نگین» as مالک" and nothing that could be used as an input to
 * another endpoint. That is why there is no organizationId/buildingId here.
 */
export interface InvitationPreviewResponse {
  readonly organizationName: string;
  readonly buildingName: string | null;
  readonly unitLabel: string | null;
  readonly organizationRole: OrganizationRole | null;
  readonly buildingRole: BuildingRole | null;
  readonly expiresAt: Date;
  readonly message: string | null;
}
