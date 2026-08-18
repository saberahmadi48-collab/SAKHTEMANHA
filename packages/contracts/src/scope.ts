import type {
  BuildingRoleName,
  OrganizationRoleName,
  Permission,
} from './permissions';

/**
 * The server-resolved authorization scope for a single request.
 *
 * BM-00 rule 8: this object is built ONLY from database rows looked up by the
 * authenticated user id. No field on it is ever populated from the request
 * body, a query parameter, or a JWT claim the client could have influenced.
 * Anything that reaches a service layer holding one of these has already been
 * proven to belong to the caller.
 */
export interface RequestScope {
  readonly userId: string;
  /** Null when the account exists but no Person record is linked yet. */
  readonly personId: string | null;
  readonly organizationId: string;
  /** Null on organization-level routes that are not building-scoped. */
  readonly buildingId: string | null;
  readonly organizationRoles: readonly OrganizationRoleName[];
  readonly buildingRoles: readonly BuildingRoleName[];
  /** Units the caller is attached to — used for "own unit" checks (BM-03). */
  readonly unitIds: readonly string[];
  /** Id of the currently ACTIVE management term for this building, if any. */
  readonly activeManagementTermId: string | null;
  /** True when the caller personally holds the manager seat in the active term. */
  readonly isActiveManager: boolean;
  readonly permissions: ReadonlySet<Permission>;
}

/** Shape of the signed access token. Deliberately minimal — see AuthService. */
export interface AccessTokenClaims {
  /** Subject: the User id. */
  readonly sub: string;
  /**
   * Token generation at issue time. If the user's current `tokenGeneration` is
   * higher, this token was issued before a password change / forced logout and
   * is rejected without needing a revocation list.
   */
  readonly gen: number;
  readonly typ: 'access';
}

export interface RefreshTokenClaims {
  readonly sub: string;
  readonly gen: number;
  /** Session id — maps to a RefreshToken row so rotation can be tracked. */
  readonly sid: string;
  readonly typ: 'refresh';
}
