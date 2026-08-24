-- BM-03 slice five — expenses, income and configurable financial categories
-- (§38/§39/§41/§42).
--
-- Written by hand rather than by `prisma migrate dev`: this database carries
-- manually-applied constraints (prisma/sql/003) that Prisma reads as drift, so
-- its only offer is a destructive reset. Apply with
--   node scripts/db-query.mjs --file prisma/migrations/<name>/migration.sql
-- then register it with `prisma migrate resolve --applied <name>`.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "FinancialCategoryKind" AS ENUM ('INCOME', 'EXPENSE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExpenseStatus" AS ENUM (
    'DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "IncomeSourceType" AS ENUM (
    'RENTAL', 'PENALTY', 'DEPOSIT', 'SUBSIDY', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The building side of LedgerReferenceType. Without these two values
-- `ledger.post` cannot be called for an expense or an income at all, so this is
-- a prerequisite of the tables below rather than a cosmetic addition.
-- IF NOT EXISTS makes the whole migration re-runnable.
ALTER TYPE "LedgerReferenceType" ADD VALUE IF NOT EXISTS 'EXPENSE';
ALTER TYPE "LedgerReferenceType" ADD VALUE IF NOT EXISTS 'INCOME';

-- ---------------------------------------------------------------------------
-- financial_categories (§42) — categories are DATA, not code.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "financial_categories" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "buildingId"  UUID NOT NULL,
  "kind"        "FinancialCategoryKind" NOT NULL,
  "name"        TEXT NOT NULL,
  "systemKey"   TEXT,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "financial_categories_pkey" PRIMARY KEY ("id")
);

-- Two categories with the same name on the same side of the books split a
-- building's reporting in half without anyone noticing.
CREATE UNIQUE INDEX IF NOT EXISTS "financial_categories_buildingId_kind_name_key"
  ON "financial_categories" ("buildingId", "kind", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "financial_categories_buildingId_systemKey_key"
  ON "financial_categories" ("buildingId", "systemKey");

CREATE INDEX IF NOT EXISTS "financial_categories_buildingId_kind_isActive_idx"
  ON "financial_categories" ("buildingId", "kind", "isActive");

-- ---------------------------------------------------------------------------
-- expenses (§38/§39)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "expenses" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "buildingId"         UUID NOT NULL,
  "categoryId"         UUID NOT NULL,
  "financialPeriodId"  UUID,
  "vendorName"         TEXT NOT NULL,
  "description"        TEXT NOT NULL,
  "invoiceReference"   TEXT,
  "amount"             DECIMAL(18,2) NOT NULL,
  "currency"           TEXT NOT NULL DEFAULT 'IRR',
  "expenseDate"        TIMESTAMPTZ(6) NOT NULL,
  "status"             "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
  "ledgerEntryId"      UUID,
  "createdByPersonId"  UUID,
  "approvedByPersonId" UUID,
  "decisionReason"     TEXT,
  "submittedAt"        TIMESTAMP(3),
  "approvedAt"         TIMESTAMP(3),
  "paidAt"             TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- The same supplier invoice must not be paid twice. NULLs are distinct in
-- Postgres, so an expense with no document number yet is unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "expenses_buildingId_vendorName_invoiceReference_key"
  ON "expenses" ("buildingId", "vendorName", "invoiceReference");

CREATE INDEX IF NOT EXISTS "expenses_buildingId_status_idx"
  ON "expenses" ("buildingId", "status");
CREATE INDEX IF NOT EXISTS "expenses_buildingId_expenseDate_idx"
  ON "expenses" ("buildingId", "expenseDate");
CREATE INDEX IF NOT EXISTS "expenses_buildingId_financialPeriodId_idx"
  ON "expenses" ("buildingId", "financialPeriodId");
CREATE INDEX IF NOT EXISTS "expenses_categoryId_idx"
  ON "expenses" ("categoryId");

-- ---------------------------------------------------------------------------
-- incomes (§41)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "incomes" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "buildingId"         UUID NOT NULL,
  "categoryId"         UUID NOT NULL,
  "financialPeriodId"  UUID NOT NULL,
  "amount"             DECIMAL(18,2) NOT NULL,
  "currency"           TEXT NOT NULL DEFAULT 'IRR',
  "receivedAt"         TIMESTAMPTZ(6) NOT NULL,
  "sourceType"         "IncomeSourceType" NOT NULL DEFAULT 'OTHER',
  "referenceType"      TEXT,
  "referenceId"        TEXT,
  "description"        TEXT NOT NULL,
  "ledgerEntryId"      UUID,
  "recordedByPersonId" UUID,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "incomes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "incomes_buildingId_receivedAt_idx"
  ON "incomes" ("buildingId", "receivedAt");
CREATE INDEX IF NOT EXISTS "incomes_buildingId_financialPeriodId_idx"
  ON "incomes" ("buildingId", "financialPeriodId");
CREATE INDEX IF NOT EXISTS "incomes_categoryId_idx"
  ON "incomes" ("categoryId");

-- ---------------------------------------------------------------------------
-- Foreign keys. Table names confirmed from @@map in schema.prisma —
-- the Person model maps to "people", NOT "persons".
-- ---------------------------------------------------------------------------

ALTER TABLE "financial_categories"
  DROP CONSTRAINT IF EXISTS "financial_categories_buildingId_fkey";
ALTER TABLE "financial_categories"
  ADD CONSTRAINT "financial_categories_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "buildings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expenses"
  DROP CONSTRAINT IF EXISTS "expenses_buildingId_fkey";
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "buildings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expenses"
  DROP CONSTRAINT IF EXISTS "expenses_categoryId_fkey";
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expenses"
  DROP CONSTRAINT IF EXISTS "expenses_financialPeriodId_fkey";
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_financialPeriodId_fkey"
  FOREIGN KEY ("financialPeriodId") REFERENCES "financial_periods"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "expenses"
  DROP CONSTRAINT IF EXISTS "expenses_createdByPersonId_fkey";
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_createdByPersonId_fkey"
  FOREIGN KEY ("createdByPersonId") REFERENCES "people"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "expenses"
  DROP CONSTRAINT IF EXISTS "expenses_approvedByPersonId_fkey";
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_approvedByPersonId_fkey"
  FOREIGN KEY ("approvedByPersonId") REFERENCES "people"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "incomes"
  DROP CONSTRAINT IF EXISTS "incomes_buildingId_fkey";
ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "buildings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incomes"
  DROP CONSTRAINT IF EXISTS "incomes_categoryId_fkey";
ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incomes"
  DROP CONSTRAINT IF EXISTS "incomes_financialPeriodId_fkey";
ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_financialPeriodId_fkey"
  FOREIGN KEY ("financialPeriodId") REFERENCES "financial_periods"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incomes"
  DROP CONSTRAINT IF EXISTS "incomes_recordedByPersonId_fkey";
ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_recordedByPersonId_fkey"
  FOREIGN KEY ("recordedByPersonId") REFERENCES "people"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
