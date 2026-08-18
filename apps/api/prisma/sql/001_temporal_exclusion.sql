-- ============================================================================
--  Temporal integrity constraints (BM-01 / BM-02)
--
--  WHY THESE LIVE IN SQL, NOT IN A SERVICE:
--  Overlap checks written in application code are read-then-write races. Two
--  concurrent "transfer ownership" requests both SELECT, both see no conflict,
--  and both INSERT — leaving a unit with two simultaneous owners and a ledger
--  that cannot be reconciled. A Postgres EXCLUDE constraint is evaluated by the
--  index at commit time, so the second transaction is rejected no matter how
--  the requests interleave.
--
--  Run after `prisma migrate dev` has created the tables:
--    psql "$DATABASE_URL" -f prisma/migrations/manual/001_temporal_exclusion.sql
--  (In CI/production this file is copied into the generated migration folder so
--   it ships as part of `prisma migrate deploy`.)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Ownership: the SAME person may not hold two overlapping title periods on the
-- SAME unit. Different people MAY overlap — that is joint ownership, which is
-- legitimate and is bounded instead by the "active shares sum to 100" rule in
-- the domain service.
-- ---------------------------------------------------------------------------
ALTER TABLE unit_ownerships
  DROP CONSTRAINT IF EXISTS unit_ownerships_no_overlap;

ALTER TABLE unit_ownerships
  ADD CONSTRAINT unit_ownerships_no_overlap
  EXCLUDE USING gist (
    "unitId" WITH =,
    "personId" WITH =,
    -- '[)' = half-open: a period ending 2024-03-01 does not collide with one
    -- starting 2024-03-01. Without this, every clean handover would fail.
    tstzrange("periodStart", "periodEnd", '[)') WITH &&
  );

-- ---------------------------------------------------------------------------
-- Occupancy: a unit may have only ONE occupancy record at any instant — you
-- cannot be simultaneously VACANT and tenanted. Note this excludes on unitId
-- alone (no personId), which is the deliberate difference from ownership.
-- ---------------------------------------------------------------------------
ALTER TABLE unit_occupancies
  DROP CONSTRAINT IF EXISTS unit_occupancies_no_overlap;

ALTER TABLE unit_occupancies
  ADD CONSTRAINT unit_occupancies_no_overlap
  EXCLUDE USING gist (
    "unitId" WITH =,
    tstzrange("periodStart", "periodEnd", '[)') WITH &&
  );

-- ---------------------------------------------------------------------------
-- Management terms: a building has at most ONE governing term at any instant
-- (BM-00 rule 1). SCHEDULED and ACTIVE terms are both included in the check —
-- a future term that overlaps the current one is a governance error, not a
-- harmless draft. TERMINATED/COMPLETED rows are excluded from the constraint
-- so that history remains writable and immutable.
-- ---------------------------------------------------------------------------
ALTER TABLE management_terms
  DROP CONSTRAINT IF EXISTS management_terms_no_overlap;

ALTER TABLE management_terms
  ADD CONSTRAINT management_terms_no_overlap
  EXCLUDE USING gist (
    "buildingId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status IN ('SCHEDULED', 'ACTIVE'));

-- ---------------------------------------------------------------------------
-- Sanity: a period may never end before it starts. Cheap CHECK constraints,
-- but they catch timezone-conversion bugs at the boundary instead of letting a
-- negative-length period silently break every "as of date" query.
-- ---------------------------------------------------------------------------
ALTER TABLE unit_ownerships
  DROP CONSTRAINT IF EXISTS unit_ownerships_period_order;
ALTER TABLE unit_ownerships
  ADD CONSTRAINT unit_ownerships_period_order
  CHECK ("periodEnd" IS NULL OR "periodEnd" > "periodStart");

ALTER TABLE unit_occupancies
  DROP CONSTRAINT IF EXISTS unit_occupancies_period_order;
ALTER TABLE unit_occupancies
  ADD CONSTRAINT unit_occupancies_period_order
  CHECK ("periodEnd" IS NULL OR "periodEnd" > "periodStart");

ALTER TABLE management_terms
  DROP CONSTRAINT IF EXISTS management_terms_period_order;
ALTER TABLE management_terms
  ADD CONSTRAINT management_terms_period_order
  CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");

-- Ownership share must be a sensible percentage.
ALTER TABLE unit_ownerships
  DROP CONSTRAINT IF EXISTS unit_ownerships_share_range;
ALTER TABLE unit_ownerships
  ADD CONSTRAINT unit_ownerships_share_range
  CHECK ("sharePercent" > 0 AND "sharePercent" <= 100);

-- A VACANT occupancy must have no person; any other kind must have one.
ALTER TABLE unit_occupancies
  DROP CONSTRAINT IF EXISTS unit_occupancies_person_matches_kind;
ALTER TABLE unit_occupancies
  ADD CONSTRAINT unit_occupancies_person_matches_kind
  CHECK (
    (kind = 'VACANT' AND "personId" IS NULL)
    OR (kind <> 'VACANT' AND "personId" IS NOT NULL)
  );
