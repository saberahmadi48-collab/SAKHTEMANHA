-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "BuildingRole" AS ENUM ('BUILDING_MANAGER', 'BOARD_MEMBER', 'AUDITOR', 'OWNER', 'TENANT', 'STAFF', 'VIEWER');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('ORG_OWNER', 'ORG_ADMIN', 'ORG_BILLING', 'ORG_VIEWER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'OFFICE', 'PARKING', 'STORAGE', 'COMMON_AREA', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_CONSTRUCTION', 'UNDER_RENOVATION', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OccupancyKind" AS ENUM ('OWNER_OCCUPIED', 'TENANT', 'OTHER', 'VACANT');

-- CreateEnum
CREATE TYPE "ManagementTermStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BuildingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'UNMANAGED', 'ARCHIVED', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('INDIVIDUAL', 'PROPERTY_MANAGEMENT_COMPANY', 'ENTERPRISE', 'OTHER');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LocationPrecision" AS ENUM ('EXACT', 'APPROXIMATE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ChargeCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "slug" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL DEFAULT 'INDIVIDUAL',
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "legalName" TEXT,
    "taxIdentifier" TEXT,
    "contactEmail" CITEXT,
    "contactPhone" TEXT,
    "defaultLocale" TEXT NOT NULL DEFAULT 'fa-IR',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'IRR',
    "defaultTimeZone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "countryCode" VARCHAR(2) NOT NULL DEFAULT 'IR',
    "province" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "postalCode" TEXT,
    "plaqueNumber" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "geoCell" TEXT,
    "locationPrecision" "LocationPrecision" NOT NULL DEFAULT 'APPROXIMATE',
    "locationProvider" TEXT,
    "locationUpdatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buildings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "addressId" UUID,
    "name" TEXT NOT NULL,
    "code" CITEXT NOT NULL,
    "status" "BuildingStatus" NOT NULL DEFAULT 'ACTIVE',
    "floorCount" INTEGER,
    "basementCount" INTEGER,
    "totalUnitCount" INTEGER,
    "constructionYear" INTEGER,
    "totalAreaSqm" DECIMAL(12,2),
    "hasElevator" BOOLEAN NOT NULL DEFAULT false,
    "elevatorCount" INTEGER NOT NULL DEFAULT 0,
    "hasParking" BOOLEAN NOT NULL DEFAULT false,
    "hasCentralHeating" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
    "locale" TEXT NOT NULL DEFAULT 'fa-IR',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_settings" (
    "buildingId" UUID NOT NULL,
    "chargeCycle" "ChargeCycle" NOT NULL DEFAULT 'MONTHLY',
    "chargeDueDay" INTEGER NOT NULL DEFAULT 10,
    "notifyByEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyBySms" BOOLEAN NOT NULL DEFAULT false,
    "notifyInApp" BOOLEAN NOT NULL DEFAULT true,
    "showResidentContacts" BOOLEAN NOT NULL DEFAULT false,
    "showUnitOwners" BOOLEAN NOT NULL DEFAULT true,
    "discoverableByProviders" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_settings_pkey" PRIMARY KEY ("buildingId")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "label" CITEXT NOT NULL,
    "kind" "UnitKind" NOT NULL DEFAULT 'RESIDENTIAL',
    "status" "UnitStatus" NOT NULL DEFAULT 'ACTIVE',
    "floor" INTEGER,
    "block" TEXT,
    "areaSqm" DECIMAL(10,2),
    "bedroomCount" INTEGER,
    "shareRatio" DECIMAL(10,6),
    "parkingSpots" INTEGER NOT NULL DEFAULT 0,
    "storageUnits" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "management_terms" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "termNumber" INTEGER NOT NULL,
    "title" TEXT,
    "status" "ManagementTermStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6),
    "managerPersonId" UUID,
    "terminationReason" TEXT,
    "terminatedAt" TIMESTAMP(3),
    "handoverStatus" "HandoverStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "handoverCompletedAt" TIMESTAMP(3),
    "previousTermId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "management_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT,
    "phoneNumber" TEXT,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "tokenGeneration" INTEGER NOT NULL DEFAULT 0,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "displayName" TEXT,
    "nationalId" TEXT,
    "email" CITEXT,
    "phoneNumber" TEXT,
    "phoneIsPublic" BOOLEAN NOT NULL DEFAULT false,
    "avatarUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'fa-IR',
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_memberships" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "role" "BuildingRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "managementTermId" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "extraPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revokedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_memberships" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "canRepresentUnit" BOOLEAN NOT NULL DEFAULT false,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_ownerships" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(6) NOT NULL,
    "periodEnd" TIMESTAMPTZ(6),
    "sharePercent" DECIMAL(6,3) NOT NULL DEFAULT 100,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "titleReference" TEXT,
    "acquiredVia" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_ownerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_occupancies" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "personId" UUID,
    "kind" "OccupancyKind" NOT NULL DEFAULT 'OWNER_OCCUPIED',
    "periodStart" TIMESTAMPTZ(6) NOT NULL,
    "periodEnd" TIMESTAMPTZ(6),
    "residentCount" INTEGER NOT NULL DEFAULT 1,
    "leaseReference" TEXT,
    "leaseStartsAt" TIMESTAMP(3),
    "leaseEndsAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_occupancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "buildingId" UUID,
    "unitId" UUID,
    "tokenHash" TEXT NOT NULL,
    "email" CITEXT,
    "phoneNumber" TEXT,
    "buildingRole" "BuildingRole",
    "organizationRole" "OrganizationRole",
    "personId" UUID,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedByUserId" UUID NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "buildingId" UUID,
    "actorUserId" UUID,
    "actorPersonId" UUID,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" UUID,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_archivedAt_idx" ON "organizations"("archivedAt");

-- CreateIndex
CREATE INDEX "addresses_organizationId_idx" ON "addresses"("organizationId");

-- CreateIndex
CREATE INDEX "addresses_city_district_idx" ON "addresses"("city", "district");

-- CreateIndex
CREATE INDEX "addresses_geoCell_idx" ON "addresses"("geoCell");

-- CreateIndex
CREATE INDEX "buildings_organizationId_status_idx" ON "buildings"("organizationId", "status");

-- CreateIndex
CREATE INDEX "buildings_archivedAt_idx" ON "buildings"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_organizationId_code_key" ON "buildings"("organizationId", "code");

-- CreateIndex
CREATE INDEX "units_buildingId_status_idx" ON "units"("buildingId", "status");

-- CreateIndex
CREATE INDEX "units_buildingId_kind_idx" ON "units"("buildingId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "units_buildingId_label_key" ON "units"("buildingId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "management_terms_previousTermId_key" ON "management_terms"("previousTermId");

-- CreateIndex
CREATE INDEX "management_terms_buildingId_status_idx" ON "management_terms"("buildingId", "status");

-- CreateIndex
CREATE INDEX "management_terms_buildingId_startsAt_endsAt_idx" ON "management_terms"("buildingId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "management_terms_buildingId_termNumber_key" ON "management_terms"("buildingId", "termNumber");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneNumber_key" ON "users"("phoneNumber");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_revokedAt_idx" ON "refresh_tokens"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "people_userId_key" ON "people"("userId");

-- CreateIndex
CREATE INDEX "people_lastName_firstName_idx" ON "people"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "people_nationalId_idx" ON "people"("nationalId");

-- CreateIndex
CREATE INDEX "organization_memberships_organizationId_status_idx" ON "organization_memberships"("organizationId", "status");

-- CreateIndex
CREATE INDEX "organization_memberships_personId_status_idx" ON "organization_memberships"("personId", "status");

-- CreateIndex
CREATE INDEX "building_memberships_buildingId_status_idx" ON "building_memberships"("buildingId", "status");

-- CreateIndex
CREATE INDEX "building_memberships_buildingId_role_status_idx" ON "building_memberships"("buildingId", "role", "status");

-- CreateIndex
CREATE INDEX "building_memberships_personId_status_idx" ON "building_memberships"("personId", "status");

-- CreateIndex
CREATE INDEX "unit_memberships_buildingId_status_idx" ON "unit_memberships"("buildingId", "status");

-- CreateIndex
CREATE INDEX "unit_memberships_unitId_status_idx" ON "unit_memberships"("unitId", "status");

-- CreateIndex
CREATE INDEX "unit_memberships_personId_status_idx" ON "unit_memberships"("personId", "status");

-- CreateIndex
CREATE INDEX "unit_ownerships_buildingId_periodStart_idx" ON "unit_ownerships"("buildingId", "periodStart");

-- CreateIndex
CREATE INDEX "unit_ownerships_unitId_periodStart_periodEnd_idx" ON "unit_ownerships"("unitId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "unit_ownerships_personId_idx" ON "unit_ownerships"("personId");

-- CreateIndex
CREATE INDEX "unit_occupancies_buildingId_periodStart_idx" ON "unit_occupancies"("buildingId", "periodStart");

-- CreateIndex
CREATE INDEX "unit_occupancies_unitId_periodStart_periodEnd_idx" ON "unit_occupancies"("unitId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "unit_occupancies_personId_idx" ON "unit_occupancies"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_organizationId_status_idx" ON "invitations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "invitations_buildingId_status_idx" ON "invitations"("buildingId", "status");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "invitations_expiresAt_idx" ON "invitations"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_buildingId_createdAt_idx" ON "audit_logs"("buildingId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_settings" ADD CONSTRAINT "building_settings_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_terms" ADD CONSTRAINT "management_terms_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_terms" ADD CONSTRAINT "management_terms_managerPersonId_fkey" FOREIGN KEY ("managerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_terms" ADD CONSTRAINT "management_terms_previousTermId_fkey" FOREIGN KEY ("previousTermId") REFERENCES "management_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_memberships" ADD CONSTRAINT "building_memberships_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_memberships" ADD CONSTRAINT "building_memberships_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_memberships" ADD CONSTRAINT "building_memberships_managementTermId_fkey" FOREIGN KEY ("managementTermId") REFERENCES "management_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_memberships" ADD CONSTRAINT "unit_memberships_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_memberships" ADD CONSTRAINT "unit_memberships_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_memberships" ADD CONSTRAINT "unit_memberships_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_ownerships" ADD CONSTRAINT "unit_ownerships_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_ownerships" ADD CONSTRAINT "unit_ownerships_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_ownerships" ADD CONSTRAINT "unit_ownerships_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_occupancies" ADD CONSTRAINT "unit_occupancies_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_occupancies" ADD CONSTRAINT "unit_occupancies_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_occupancies" ADD CONSTRAINT "unit_occupancies_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
