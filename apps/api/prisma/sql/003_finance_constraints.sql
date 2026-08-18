-- ============================================================================
--  BM-03 finance constraints that Prisma cannot express
--
--  Everything in here exists because the rule is either conditional (a partial
--  index), a property of a value rather than a row shape (a CHECK), or a
--  concurrency guarantee that an application-level check cannot provide.
--
--  Apply after `prisma migrate deploy`, exactly like 001 and 002.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  MONEY SANITY (§62 — never trust a client-supplied amount)
--
--  These are the last line of defence, not the first: the DTO layer validates
--  too. But a negative charge would silently invert a unit's balance, and a
--  ledger entry of 0 is a row that claims a financial event happened while
--  changing nothing — both are worth making impossible in the database.
-- ---------------------------------------------------------------------------

ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_amounts_non_negative;
ALTER TABLE charges ADD CONSTRAINT charges_amounts_non_negative
  CHECK ("baseAmount" >= 0 AND "calculatedAmount" >= 0);

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_amount_positive;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_amount_positive
  CHECK (amount > 0);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_amounts_non_negative;
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_non_negative
  CHECK (
    subtotal >= 0 AND discount >= 0 AND penalty >= 0
    AND total >= 0 AND "paidAmount" >= 0
  );

-- A credit can never have more remaining than it was worth, and never below
-- zero. Without this, an over-application bug quietly mints money.
ALTER TABLE unit_credits DROP CONSTRAINT IF EXISTS unit_credits_remaining_within_bounds;
ALTER TABLE unit_credits ADD CONSTRAINT unit_credits_remaining_within_bounds
  CHECK ("remainingAmount" >= 0 AND "remainingAmount" <= amount);

-- ---------------------------------------------------------------------------
--  PERIOD INTEGRITY (§9)
-- ---------------------------------------------------------------------------

ALTER TABLE financial_periods DROP CONSTRAINT IF EXISTS financial_periods_month_range;
ALTER TABLE financial_periods ADD CONSTRAINT financial_periods_month_range
  CHECK (month BETWEEN 1 AND 12 AND year BETWEEN 1300 AND 1600);

-- Half-open [startsAt, endsAt) must be a real interval. The equivalent bug in
-- BM-01 (endsAt < startsAt on an activated management term) produced a raw 500
-- in the first e2e run; the same shape is blocked here from the start.
ALTER TABLE financial_periods DROP CONSTRAINT IF EXISTS financial_periods_period_order;
ALTER TABLE financial_periods ADD CONSTRAINT financial_periods_period_order
  CHECK ("endsAt" > "startsAt");

-- Two financial periods of one building must not cover the same instant.
-- @@unique(buildingId, year, month) already prevents the ordinary duplicate,
-- but it cannot stop a mis-dated 1404-07 whose range overlaps 1404-08.
ALTER TABLE financial_periods DROP CONSTRAINT IF EXISTS financial_periods_no_overlap;
ALTER TABLE financial_periods ADD CONSTRAINT financial_periods_no_overlap
  EXCLUDE USING gist (
    "buildingId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  );

-- ---------------------------------------------------------------------------
--  CHARGE RULE EFFECTIVITY (§19)
-- ---------------------------------------------------------------------------

ALTER TABLE charge_rules DROP CONSTRAINT IF EXISTS charge_rules_effectivity_order;
ALTER TABLE charge_rules ADD CONSTRAINT charge_rules_effectivity_order
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

-- Only ONE version of a named rule may be ACTIVE at a time. Superseding a rule
-- means closing the old version and activating the new one; this index makes
-- "two active formulas both claiming to be the monthly charge" impossible, which
-- is what §52 requires for reproducibility.
DROP INDEX IF EXISTS charge_rules_single_active_version;
CREATE UNIQUE INDEX charge_rules_single_active_version
  ON charge_rules ("buildingId", name)
  WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
--  CHARGE GENERATION IDEMPOTENCY (§51)
--
--  THE CORE ANTI-DUPLICATE RULE. Running the monthly process twice must not
--  bill a resident twice. Two independent guards, deliberately:
--
--   1. charge_runs @@unique(buildingId, financialPeriodId) — declared in the
--      Prisma schema. Stops a second RUN from starting.
--   2. The index below — stops a duplicate CHARGE even if it arrives by another
--      path (a manual retry, a partially-failed run being re-driven).
--
--  One guard would be enough on a happy path. Two are here because the failure
--  mode is a resident being charged twice for one month, which costs real money
--  and real trust to unwind.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS charges_one_per_rule_unit_period;
CREATE UNIQUE INDEX charges_one_per_rule_unit_period
  ON charges ("buildingId", "unitId", "financialPeriodId", "chargeRuleId")
  WHERE "chargeRuleId" IS NOT NULL AND status <> 'REVERSED';

-- ---------------------------------------------------------------------------
--  INVOICE NUMBERING (§23)
--
--  "Unique, auditable, predictable, never reused after issuance."
--
--  The Prisma-level @@unique(buildingId, invoiceNumber) covers uniqueness. This
--  sequence table is what makes allocation SAFE UNDER CONCURRENCY: two managers
--  issuing invoices in the same second must never receive the same number.
--  Allocation is a single UPDATE ... RETURNING inside the issuing transaction,
--  which takes a row lock and serialises the two callers.
--
--  A COUNT(*)+1 approach is the tempting alternative and is wrong: it reuses a
--  number as soon as anything is rolled back, and races under load.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoice_number_sequences (
  "buildingId" uuid    NOT NULL,
  year         integer NOT NULL,
  month        integer NOT NULL,
  "lastValue"  integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("buildingId", year, month)
);

-- Allocates the next invoice number for a building/period atomically.
-- Returns the new integer counter; the service formats it as 1404-07-000101.
CREATE OR REPLACE FUNCTION next_invoice_number(
  p_building_id uuid,
  p_year        integer,
  p_month       integer
) RETURNS integer AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO invoice_number_sequences AS s ("buildingId", year, month, "lastValue")
  VALUES (p_building_id, p_year, p_month, 1)
  ON CONFLICT ("buildingId", year, month)
  DO UPDATE SET "lastValue" = s."lastValue" + 1
  RETURNING s."lastValue" INTO v_next;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
--  LEDGER APPEND-ONLY ENFORCEMENT (§7/§46)
--
--  The application never updates or deletes a ledger entry — but "the code is
--  careful" is not a guarantee, and a ledger that can be edited is not a ledger.
--  This trigger makes the rule structural: a correction MUST be a new reversal
--  entry, because the database will not accept anything else.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ledger_entries_reject_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries is append-only: correct with a REVERSAL entry (BM-03 §46)'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_no_update ON ledger_entries;
CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_reject_mutation();

-- ---------------------------------------------------------------------------
--  HOT-PATH PARTIAL INDEXES
--
--  Kept small on purpose: unpaid invoices are a tiny fraction of rows once a
--  building has years of history, and the dashboard (§53) reads exactly these.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS invoices_outstanding;
CREATE INDEX invoices_outstanding
  ON invoices ("buildingId", "dueDate")
  WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE');

DROP INDEX IF EXISTS unit_credits_available;
CREATE INDEX unit_credits_available
  ON unit_credits ("buildingId", "unitId")
  WHERE status IN ('AVAILABLE', 'PARTIALLY_APPLIED');

DROP INDEX IF EXISTS financial_periods_open;
CREATE INDEX financial_periods_open
  ON financial_periods ("buildingId")
  WHERE status IN ('OPEN', 'REOPENED');
