-- ============================================================================
--  Partial unique indexes (BM-02)
--
--  Prisma's @@unique is always total. These rules are conditional — "unique
--  among ACTIVE rows, unlimited among historical rows" — which is exactly what
--  R2 (never hard-delete) forces on us: closed membership rows accumulate, so a
--  total unique index on (building, person, role) would make it impossible to
--  ever re-appoint someone who previously held the role.
-- ============================================================================

-- A person holds a given building role at most once AT A TIME.
-- Re-appointment after an ENDED term is allowed, and is a new row.
DROP INDEX IF EXISTS building_memberships_active_unique;
CREATE UNIQUE INDEX building_memberships_active_unique
  ON building_memberships ("buildingId", "personId", role)
  WHERE status IN ('ACTIVE', 'PENDING', 'SUSPENDED');

DROP INDEX IF EXISTS organization_memberships_active_unique;
CREATE UNIQUE INDEX organization_memberships_active_unique
  ON organization_memberships ("organizationId", "personId", role)
  WHERE status IN ('ACTIVE', 'PENDING', 'SUSPENDED');

DROP INDEX IF EXISTS unit_memberships_active_unique;
CREATE UNIQUE INDEX unit_memberships_active_unique
  ON unit_memberships ("unitId", "personId")
  WHERE status IN ('ACTIVE', 'PENDING', 'SUSPENDED');

-- Exactly one primary contact per unit at a time. Enforced here rather than in
-- code because "promote X to primary" is a two-statement operation that would
-- otherwise leave a window with two primaries under concurrency.
DROP INDEX IF EXISTS unit_memberships_single_primary;
CREATE UNIQUE INDEX unit_memberships_single_primary
  ON unit_memberships ("unitId")
  WHERE "isPrimaryContact" = true AND status = 'ACTIVE';

-- At most one ACTIVE management term per building. This overlaps with the
-- EXCLUDE constraint in 001 but is far cheaper for the hot-path lookup
-- "who currently manages building X", and it also serves as that query's index.
DROP INDEX IF EXISTS management_terms_single_active;
CREATE UNIQUE INDEX management_terms_single_active
  ON management_terms ("buildingId")
  WHERE status = 'ACTIVE';

-- One primary owner of record per unit at a time (statutory notice recipient).
DROP INDEX IF EXISTS unit_ownerships_single_primary_current;
CREATE UNIQUE INDEX unit_ownerships_single_primary_current
  ON unit_ownerships ("unitId")
  WHERE "isPrimary" = true AND "periodEnd" IS NULL;

-- Only one PENDING invitation per (scope, email) — prevents invitation spam
-- and the "which of these three links is live?" support ticket.
-- COALESCE gives org-level invitations (buildingId NULL) a stable key, because
-- NULLs are never equal to each other in a unique index.
DROP INDEX IF EXISTS invitations_pending_unique_email;
CREATE UNIQUE INDEX invitations_pending_unique_email
  ON invitations (
    "organizationId",
    COALESCE("buildingId", '00000000-0000-0000-0000-000000000000'::uuid),
    email
  )
  WHERE status = 'PENDING' AND email IS NOT NULL;

-- Fast "current" lookups. Partial indexes keep these small: the open period is
-- a tiny fraction of rows once a building has years of history.
DROP INDEX IF EXISTS unit_ownerships_current;
CREATE INDEX unit_ownerships_current
  ON unit_ownerships ("buildingId", "unitId")
  WHERE "periodEnd" IS NULL;

DROP INDEX IF EXISTS unit_occupancies_current;
CREATE INDEX unit_occupancies_current
  ON unit_occupancies ("buildingId", "unitId")
  WHERE "periodEnd" IS NULL;
