/**
 * Permission catalogue and role -> permission mapping for the Building
 * Operations Platform.
 *
 * Shared between the API (enforcement) and the web client (UI affordances).
 * The client copy is for HIDING buttons only — every permission is re-checked
 * server-side on every request (BM-00 rule 8). A permission string that only
 * the frontend knows about is a bug, not a feature.
 *
 * Naming: "<resource>:<action>". Resource and action are the last two legs of
 * the BM-00 authorization tuple (Role + Organization + Building + Resource +
 * Action); the first three come from the request's resolved scope.
 */

export const PERMISSIONS = {
  // --- BM-01: building & structure -----------------------------------------
  BUILDING_READ: 'building:read',
  BUILDING_UPDATE: 'building:update',
  BUILDING_ARCHIVE: 'building:archive',
  UNIT_READ: 'unit:read',
  UNIT_CREATE: 'unit:create',
  UNIT_UPDATE: 'unit:update',
  UNIT_ARCHIVE: 'unit:archive',

  // --- BM-01/BM-06: governance ---------------------------------------------
  TERM_READ: 'term:read',
  TERM_CREATE: 'term:create',
  TERM_UPDATE: 'term:update',
  TERM_TERMINATE: 'term:terminate',
  HANDOVER_MANAGE: 'handover:manage',

  // --- BM-02: people & access ----------------------------------------------
  MEMBER_READ: 'member:read',
  MEMBER_INVITE: 'member:invite',
  MEMBER_UPDATE_ROLE: 'member:update_role',
  MEMBER_REMOVE: 'member:remove',
  /** Read a resident's unmasked contact details (BM-00 rule 6 — privacy). */
  PERSON_READ_CONTACT: 'person:read_contact',
  OWNERSHIP_READ: 'ownership:read',
  OWNERSHIP_MANAGE: 'ownership:manage',
  OCCUPANCY_READ: 'occupancy:read',
  OCCUPANCY_MANAGE: 'occupancy:manage',
  /**
   * Decide whether a claimed ownership/occupancy is true (BM-02 §31/§32).
   *
   * Deliberately SEPARATE from OWNERSHIP_MANAGE: recording "flat 12 was sold to
   * X" is data entry, whereas attesting that the deed was seen is a statement of
   * trust that later phases (voting weight, legal notices) rely on. Whoever can
   * type a claim must not be able to bless their own claim.
   */
  VERIFICATION_MANAGE: 'verification:manage',
  /**
   * Approve or reject a request to join a building (BM-02 §30).
   *
   * A building name alone is never authorization — someone with this permission
   * must affirmatively let the requester in.
   */
  JOIN_REQUEST_REVIEW: 'join_request:review',

  // --- BM-03/BM-04: finance (declared now so roles stay stable) ------------
  LEDGER_READ: 'ledger:read',
  CHARGE_READ: 'charge:read',
  CHARGE_CREATE: 'charge:create',
  /** Reversal/adjustment only — there is no "delete charge" permission (R2). */
  CHARGE_ADJUST: 'charge:adjust',
  INVOICE_READ: 'invoice:read',
  INVOICE_ISSUE: 'invoice:issue',
  PAYMENT_READ: 'payment:read',
  PAYMENT_RECORD: 'payment:record',
  /** Read one's OWN unit ledger. Every resident holds this. */
  OWN_LEDGER_READ: 'own_ledger:read',

  // --- BM-05: maintenance ---------------------------------------------------
  WORKORDER_READ: 'workorder:read',
  WORKORDER_CREATE: 'workorder:create',
  WORKORDER_ASSIGN: 'workorder:assign',
  WORKORDER_CLOSE: 'workorder:close',

  // --- BM-07: comms & documents --------------------------------------------
  ANNOUNCEMENT_READ: 'announcement:read',
  ANNOUNCEMENT_PUBLISH: 'announcement:publish',
  DOCUMENT_READ: 'document:read',
  DOCUMENT_UPLOAD: 'document:upload',

  // --- Audit ---------------------------------------------------------------
  AUDIT_READ: 'audit:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Mirrors the Prisma `BuildingRole` enum. Kept as a plain union so the shared
 *  contracts package never has to import the generated Prisma client. */
export type BuildingRoleName =
  | 'BUILDING_MANAGER'
  | 'BOARD_MEMBER'
  | 'AUDITOR'
  | 'OWNER'
  | 'TENANT'
  | 'STAFF'
  | 'VIEWER';

/** Mirrors the Prisma `OrganizationRole` enum. */
export type OrganizationRoleName =
  | 'ORG_OWNER'
  | 'ORG_ADMIN'
  | 'ORG_BILLING'
  | 'ORG_VIEWER';

const P = PERMISSIONS;

/**
 * Baseline every authenticated member of a building holds, whatever their role.
 * Note it contains OWN_LEDGER_READ but not LEDGER_READ: a tenant may see their
 * own balance, never the building's books.
 */
const RESIDENT_BASE: readonly Permission[] = [
  P.BUILDING_READ,
  P.UNIT_READ,
  P.TERM_READ,
  P.OWN_LEDGER_READ,
  P.WORKORDER_CREATE,
  P.WORKORDER_READ,
  P.ANNOUNCEMENT_READ,
  P.DOCUMENT_READ,
];

/**
 * Building-role permission matrix.
 *
 * BUILDING_MANAGER is intentionally NOT "everything": destructive and
 * governance-defining actions (terminating a term, archiving the building) stay
 * out of the elected manager's hands and sit with the organization tier. That
 * is BM-00 rule 1 expressed as authorization — a temporary officeholder must
 * not be able to erase the permanent entity or extend their own mandate.
 */
export const BUILDING_ROLE_PERMISSIONS: Readonly<
  Record<BuildingRoleName, readonly Permission[]>
> = {
  BUILDING_MANAGER: [
    ...RESIDENT_BASE,
    P.BUILDING_UPDATE,
    P.UNIT_CREATE,
    P.UNIT_UPDATE,
    P.UNIT_ARCHIVE,
    P.MEMBER_READ,
    P.MEMBER_INVITE,
    P.MEMBER_UPDATE_ROLE,
    P.MEMBER_REMOVE,
    P.PERSON_READ_CONTACT,
    P.OWNERSHIP_READ,
    P.OWNERSHIP_MANAGE,
    P.OCCUPANCY_READ,
    P.OCCUPANCY_MANAGE,
    P.VERIFICATION_MANAGE,
    P.JOIN_REQUEST_REVIEW,
    P.LEDGER_READ,
    P.CHARGE_READ,
    P.CHARGE_CREATE,
    P.CHARGE_ADJUST,
    P.INVOICE_READ,
    P.INVOICE_ISSUE,
    P.PAYMENT_READ,
    P.PAYMENT_RECORD,
    P.WORKORDER_ASSIGN,
    P.WORKORDER_CLOSE,
    P.ANNOUNCEMENT_PUBLISH,
    P.DOCUMENT_UPLOAD,
    P.HANDOVER_MANAGE,
    P.AUDIT_READ,
  ],

  BOARD_MEMBER: [
    ...RESIDENT_BASE,
    P.MEMBER_READ,
    P.OWNERSHIP_READ,
    P.OCCUPANCY_READ,
    // The board reviews join requests but does NOT attest to deeds: verification
    // is the manager's operational duty, and splitting it keeps a single board
    // member from admitting themselves and then blessing their own title.
    P.JOIN_REQUEST_REVIEW,
    P.LEDGER_READ,
    P.CHARGE_READ,
    P.INVOICE_READ,
    P.PAYMENT_READ,
    P.WORKORDER_ASSIGN,
    P.ANNOUNCEMENT_PUBLISH,
    P.DOCUMENT_UPLOAD,
  ],

  // Read-only over finance by design: an auditor who can edit the books is not
  // an auditor. No CHARGE_* or PAYMENT_RECORD here, ever.
  AUDITOR: [
    ...RESIDENT_BASE,
    P.MEMBER_READ,
    P.OWNERSHIP_READ,
    P.OCCUPANCY_READ,
    P.LEDGER_READ,
    P.CHARGE_READ,
    P.INVOICE_READ,
    P.PAYMENT_READ,
    P.AUDIT_READ,
  ],

  OWNER: [...RESIDENT_BASE, P.MEMBER_READ, P.OWNERSHIP_READ],

  TENANT: [...RESIDENT_BASE],

  STAFF: [...RESIDENT_BASE, P.WORKORDER_ASSIGN, P.WORKORDER_CLOSE],

  VIEWER: [P.BUILDING_READ, P.UNIT_READ, P.TERM_READ, P.ANNOUNCEMENT_READ],
};

/**
 * Organization-role permissions. These apply to EVERY building in the org, and
 * are unioned with any building-level role the same person holds.
 */
export const ORGANIZATION_ROLE_PERMISSIONS: Readonly<
  Record<OrganizationRoleName, readonly Permission[]>
> = {
  ORG_OWNER: Object.values(PERMISSIONS),
  ORG_ADMIN: Object.values(PERMISSIONS).filter(
    // The org admin runs operations but cannot archive the permanent entity
    // (R1) — that stays with the org owner.
    (p) => p !== PERMISSIONS.BUILDING_ARCHIVE,
  ),
  ORG_BILLING: [
    P.BUILDING_READ,
    P.UNIT_READ,
    P.LEDGER_READ,
    P.CHARGE_READ,
    P.INVOICE_READ,
    P.INVOICE_ISSUE,
    P.PAYMENT_READ,
    P.PAYMENT_RECORD,
  ],
  ORG_VIEWER: [
    P.BUILDING_READ,
    P.UNIT_READ,
    P.TERM_READ,
    P.MEMBER_READ,
    P.LEDGER_READ,
    P.CHARGE_READ,
    P.INVOICE_READ,
    P.PAYMENT_READ,
    P.WORKORDER_READ,
    P.ANNOUNCEMENT_READ,
    P.DOCUMENT_READ,
  ],
};

/**
 * Resolves the effective permission set for one scope evaluation.
 *
 * Order matters and is deliberate: role defaults are unioned, per-membership
 * `extraPermissions` are added, and `revokedPermissions` are subtracted LAST.
 * An explicit deny therefore always beats any grant — the safe direction when
 * an administrator revokes access in a hurry.
 */
export function resolveEffectivePermissions(input: {
  buildingRoles: readonly BuildingRoleName[];
  organizationRoles: readonly OrganizationRoleName[];
  extraPermissions?: readonly string[];
  revokedPermissions?: readonly string[];
}): ReadonlySet<Permission> {
  const granted = new Set<Permission>();

  for (const role of input.organizationRoles) {
    for (const permission of ORGANIZATION_ROLE_PERMISSIONS[role] ?? []) {
      granted.add(permission);
    }
  }
  for (const role of input.buildingRoles) {
    for (const permission of BUILDING_ROLE_PERMISSIONS[role] ?? []) {
      granted.add(permission);
    }
  }

  const known = new Set<string>(Object.values(PERMISSIONS));
  for (const extra of input.extraPermissions ?? []) {
    // Unknown strings are ignored rather than trusted: a typo in a grant must
    // never widen access, and stale grants from a removed feature must not
    // resurrect it.
    if (known.has(extra)) granted.add(extra as Permission);
  }
  for (const revoked of input.revokedPermissions ?? []) {
    granted.delete(revoked as Permission);
  }

  return granted;
}
