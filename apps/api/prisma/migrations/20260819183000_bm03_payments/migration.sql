-- BM-03 §29/§30/§35 — payments.
--
-- Written by hand rather than by `prisma migrate dev`: this database carries
-- objects Prisma does not know about (invoice_number_sequences and the manual
-- constraints in prisma/sql/003), so migrate always reports drift and offers
-- only a destructive reset. Applied with scripts/db-query.mjs, then registered
-- with `prisma migrate resolve --applied`.

CREATE TYPE "PaymentStatus" AS ENUM (
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'REFUND_PENDING',
  'REFUNDED',
  'REVERSED'
);

CREATE TYPE "PaymentMethod" AS ENUM (
  'MANUAL_CASH',
  'MANUAL_BANK_TRANSFER',
  'MANUAL_POS',
  'ONLINE_GATEWAY',
  'CREDIT_APPLICATION'
);

CREATE TABLE "payments" (
  "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
  "buildingId"            UUID NOT NULL,
  "unitId"                UUID NOT NULL,
  "invoiceId"             UUID,
  "financialPeriodId"     UUID NOT NULL,

  "provider"              TEXT NOT NULL DEFAULT 'MANUAL',
  "providerTransactionId" TEXT,
  "method"                "PaymentMethod" NOT NULL DEFAULT 'MANUAL_BANK_TRANSFER',

  "amount"                DECIMAL(18,2) NOT NULL,
  "currency"              TEXT NOT NULL DEFAULT 'IRR',
  "settledAmount"         DECIMAL(18,2) NOT NULL DEFAULT 0,

  "status"                "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "ledgerEntryId"         UUID,

  "recordedByPersonId"    UUID,
  "note"                  TEXT,

  "requestedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt"            TIMESTAMP(3),
  "failedAt"              TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_financialPeriodId_fkey"
  FOREIGN KEY ("financialPeriodId") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_recordedByPersonId_fkey"
  FOREIGN KEY ("recordedByPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- §35 — the anti-double-settle constraint. Postgres treats NULLs as distinct,
-- so a gateway payment that has no reference yet is unaffected, while any two
-- payments claiming the same provider reference collide here rather than
-- settling the same money twice.
CREATE UNIQUE INDEX "payments_provider_providerTransactionId_key"
  ON "payments"("provider", "providerTransactionId");

CREATE INDEX "payments_buildingId_status_idx"      ON "payments"("buildingId", "status");
CREATE INDEX "payments_unitId_requestedAt_idx"     ON "payments"("unitId", "requestedAt");
CREATE INDEX "payments_invoiceId_idx"              ON "payments"("invoiceId");
CREATE INDEX "payments_buildingId_periodId_idx"    ON "payments"("buildingId", "financialPeriodId");
