-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "unit_occupancies" ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByPersonId" UUID;

-- AlterTable
ALTER TABLE "unit_ownerships" ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByPersonId" UUID;

-- CreateIndex
CREATE INDEX "unit_occupancies_buildingId_verificationStatus_idx" ON "unit_occupancies"("buildingId", "verificationStatus");

-- CreateIndex
CREATE INDEX "unit_ownerships_buildingId_verificationStatus_idx" ON "unit_ownerships"("buildingId", "verificationStatus");

-- AddForeignKey
ALTER TABLE "unit_ownerships" ADD CONSTRAINT "unit_ownerships_verifiedByPersonId_fkey" FOREIGN KEY ("verifiedByPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_occupancies" ADD CONSTRAINT "unit_occupancies_verifiedByPersonId_fkey" FOREIGN KEY ("verifiedByPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
