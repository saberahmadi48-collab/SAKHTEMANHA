import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  BuildingRole,
  MembershipStatus,
  OrganizationRole,
} from '@prisma/client';

import type { PersonSummary } from '../../../core/privacy/contact-privacy';

/**
 * Request/response shapes for the membership endpoints (BM-01 §33, BM-00 rule 8).
 *
 * WHAT IS ABSENT AGAIN CARRIES THE SECURITY: no DTO here accepts a
 * `personId`, `buildingId`, or `organizationId`. The person is named in the
 * route path (and re-checked against the proven scope), the tenant comes from
 * the scope itself. A body that could name its own subject would let a manager
 * re-role someone in another building by editing JSON.
 *
 * There is also NO DTO for creating a membership. Memberships are minted in
 * exactly two places — the organization-creation transaction and invitation
 * acceptance — and adding a create-DTO here would open a third path that
 * bypasses both (§33 forbids joining without an invitation).
 */

/** Trims a string and returns undefined for blanks, so optional stays optional. */
const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? undefined : next;
};

/**
 * Changes a building membership's role or status.
 *
 * `ENDED` is deliberately NOT reachable through `status`: ending a membership
 * is a separate, audited endpoint that also stamps `endedAt`. Allowing it here
 * would let a routine edit close someone's access with no distinct audit action
 * and no end date — losing exactly the temporal fact R2 exists to preserve.
 */
export class UpdateBuildingMembershipDto {
  @IsOptional()
  @IsEnum(BuildingRole)
  role?: BuildingRole;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: Exclude<MembershipStatus, 'ENDED'>;
}

/** Organization-tier equivalent. Same `ENDED` exclusion, same reason. */
export class UpdateOrganizationMembershipDto {
  @IsOptional()
  @IsEnum(OrganizationRole)
  role?: OrganizationRole;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: Exclude<MembershipStatus, 'ENDED'>;
}

/** Ends a membership. The reason is recorded on the audit row, not the entity. */
export class EndMembershipDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimmed)
  reason?: string;
}

/**
 * A person as shown in a member list.
 *
 * `phoneNumber` and `email` are MASKED unless the caller holds
 * PERSON_READ_CONTACT (BM-00 rule 6). The service decides; this shape merely
 * carries whatever it decided, which is why the fields are nullable rather than
 * conditionally present — a client rendering `null` shows "ثبت نشده", while a
 * missing key would silently render `undefined`.
 *
 * Aliased to the shared `PersonSummary` rather than redeclared: two structurally
 * identical person shapes drift the moment one gains a field, and the one that
 * drifts is usually the one that forgets to mask it.
 */
export type MemberPersonSummary = PersonSummary;

/** One building membership row. */
export interface BuildingMemberResponse {
  readonly id: string;
  readonly buildingId: string;
  readonly person: MemberPersonSummary;
  readonly role: BuildingRole;
  readonly status: MembershipStatus;
  readonly managementTermId: string | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  /** Units this person is attached to in this building (§33 directory view). */
  readonly unitIds: readonly string[];
}

/** One organization membership row. */
export interface OrganizationMemberResponse {
  readonly id: string;
  readonly organizationId: string;
  readonly person: MemberPersonSummary;
  readonly role: OrganizationRole;
  readonly status: MembershipStatus;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}
