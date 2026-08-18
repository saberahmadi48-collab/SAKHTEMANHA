-- CreateEnum
CREATE TYPE "FinancialPeriodStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('REGULAR', 'EXTRAORDINARY', 'UTILITY', 'REPAIR', 'PENALTY', 'CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "ChargeCalculationMethod" AS ENUM ('FIXED', 'AREA_BASED', 'FIXED_PLUS_AREA', 'PER_PERSON', 'CONSUMPTION_BASED', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ChargeRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('DRAFT', 'ISSUED', 'INVOICED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REVERSED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerReferenceType" AS ENUM ('CHARGE', 'INVOICE', 'PAYMENT', 'ADJUSTMENT', 'REFUND', 'CREDIT_APPLICATION', 'OPENING_BALANCE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('AVAILABLE', 'PARTIALLY_APPLIED', 'APPLIED', 'REFUNDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FinancialAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateTable
CREATE TABLE "building_financial_accounts" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "status" "FinancialAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "fiscalYear" INTEGER NOT NULL,
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_financial_accounts" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "status" "FinancialAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_periods" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "FinancialPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedByPersonId" UUID,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_rules" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "chargeType" "ChargeType" NOT NULL DEFAULT 'REGULAR',
    "calculationMethod" "ChargeCalculationMethod" NOT NULL DEFAULT 'FIXED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(6),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" "ChargeRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "appliesToUnitKinds" "UnitKind"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charge_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_runs" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "financialPeriodId" UUID NOT NULL,
    "unitsEvaluated" INTEGER NOT NULL DEFAULT 0,
    "chargesCreated" INTEGER NOT NULL DEFAULT 0,
    "invoicesIssued" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "startedByPersonId" UUID,
    "failureReason" TEXT,

    CONSTRAINT "charge_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charges" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "financialPeriodId" UUID NOT NULL,
    "chargeRuleId" UUID,
    "chargeRunId" UUID,
    "chargeType" "ChargeType" NOT NULL,
    "calculationMethod" "ChargeCalculationMethod" NOT NULL,
    "baseAmount" DECIMAL(18,2) NOT NULL,
    "calculatedAmount" DECIMAL(18,2) NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "reason" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversedByChargeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_calculation_snapshots" (
    "id" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "formulaVersion" INTEGER NOT NULL,
    "chargeRuleId" UUID,
    "inputs" JSONB NOT NULL,
    "values" JSONB NOT NULL,
    "calculatedAmount" DECIMAL(18,2) NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charge_calculation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "financialPeriodId" UUID NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMPTZ(6) NOT NULL,
    "dueDate" TIMESTAMPTZ(6) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "penalty" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "chargeId" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "unitId" UUID,
    "financialPeriodId" UUID NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "referenceType" "LedgerReferenceType" NOT NULL,
    "referenceId" UUID,
    "description" TEXT,
    "reversesEntryId" UUID,
    "idempotencyKey" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByPersonId" UUID,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_credits" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "remainingAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "status" "CreditStatus" NOT NULL DEFAULT 'AVAILABLE',
    "sourceReferenceType" "LedgerReferenceType" NOT NULL DEFAULT 'PAYMENT',
    "sourceReferenceId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "building_financial_accounts_buildingId_key" ON "building_financial_accounts"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_financial_accounts_unitId_key" ON "unit_financial_accounts"("unitId");

-- CreateIndex
CREATE INDEX "unit_financial_accounts_buildingId_status_idx" ON "unit_financial_accounts"("buildingId", "status");

-- CreateIndex
CREATE INDEX "financial_periods_buildingId_status_idx" ON "financial_periods"("buildingId", "status");

-- CreateIndex
CREATE INDEX "financial_periods_buildingId_startsAt_idx" ON "financial_periods"("buildingId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "financial_periods_buildingId_year_month_key" ON "financial_periods"("buildingId", "year", "month");

-- CreateIndex
CREATE INDEX "charge_rules_buildingId_status_effectiveFrom_idx" ON "charge_rules"("buildingId", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "charge_rules_buildingId_name_version_key" ON "charge_rules"("buildingId", "name", "version");

-- CreateIndex
CREATE INDEX "charge_runs_buildingId_startedAt_idx" ON "charge_runs"("buildingId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "charge_runs_buildingId_financialPeriodId_key" ON "charge_runs"("buildingId", "financialPeriodId");

-- CreateIndex
CREATE INDEX "charges_buildingId_financialPeriodId_idx" ON "charges"("buildingId", "financialPeriodId");

-- CreateIndex
CREATE INDEX "charges_unitId_financialPeriodId_idx" ON "charges"("unitId", "financialPeriodId");

-- CreateIndex
CREATE INDEX "charges_buildingId_status_idx" ON "charges"("buildingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "charge_calculation_snapshots_chargeId_key" ON "charge_calculation_snapshots"("chargeId");

-- CreateIndex
CREATE INDEX "charge_calculation_snapshots_buildingId_calculatedAt_idx" ON "charge_calculation_snapshots"("buildingId", "calculatedAt");

-- CreateIndex
CREATE INDEX "invoices_buildingId_status_idx" ON "invoices"("buildingId", "status");

-- CreateIndex
CREATE INDEX "invoices_unitId_issueDate_idx" ON "invoices"("unitId", "issueDate");

-- CreateIndex
CREATE INDEX "invoices_buildingId_financialPeriodId_idx" ON "invoices"("buildingId", "financialPeriodId");

-- CreateIndex
CREATE INDEX "invoices_buildingId_dueDate_idx" ON "invoices"("buildingId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_buildingId_invoiceNumber_key" ON "invoices"("buildingId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_sortOrder_idx" ON "invoice_lines"("invoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "invoice_lines_buildingId_idx" ON "invoice_lines"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_chargeId_key" ON "invoice_lines"("chargeId");

-- CreateIndex
CREATE INDEX "ledger_entries_buildingId_occurredAt_idx" ON "ledger_entries"("buildingId", "occurredAt");

-- CreateIndex
CREATE INDEX "ledger_entries_unitId_occurredAt_idx" ON "ledger_entries"("unitId", "occurredAt");

-- CreateIndex
CREATE INDEX "ledger_entries_buildingId_financialPeriodId_idx" ON "ledger_entries"("buildingId", "financialPeriodId");

-- CreateIndex
CREATE INDEX "ledger_entries_referenceType_referenceId_idx" ON "ledger_entries"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_buildingId_idempotencyKey_key" ON "ledger_entries"("buildingId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "unit_credits_buildingId_status_idx" ON "unit_credits"("buildingId", "status");

-- CreateIndex
CREATE INDEX "unit_credits_unitId_status_idx" ON "unit_credits"("unitId", "status");

-- AddForeignKey
ALTER TABLE "building_financial_accounts" ADD CONSTRAINT "building_financial_accounts_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_financial_accounts" ADD CONSTRAINT "unit_financial_accounts_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_financial_accounts" ADD CONSTRAINT "unit_financial_accounts_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_closedByPersonId_fkey" FOREIGN KEY ("closedByPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_rules" ADD CONSTRAINT "charge_rules_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_runs" ADD CONSTRAINT "charge_runs_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_runs" ADD CONSTRAINT "charge_runs_financialPeriodId_fkey" FOREIGN KEY ("financialPeriodId") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_runs" ADD CONSTRAINT "charge_runs_startedByPersonId_fkey" FOREIGN KEY ("startedByPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_financialPeriodId_fkey" FOREIGN KEY ("financialPeriodId") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_chargeRuleId_fkey" FOREIGN KEY ("chargeRuleId") REFERENCES "charge_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_chargeRunId_fkey" FOREIGN KEY ("chargeRunId") REFERENCES "charge_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_calculation_snapshots" ADD CONSTRAINT "charge_calculation_snapshots_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_financialPeriodId_fkey" FOREIGN KEY ("financialPeriodId") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_financialPeriodId_fkey" FOREIGN KEY ("financialPeriodId") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_createdByPersonId_fkey" FOREIGN KEY ("createdByPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_credits" ADD CONSTRAINT "unit_credits_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_credits" ADD CONSTRAINT "unit_credits_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
