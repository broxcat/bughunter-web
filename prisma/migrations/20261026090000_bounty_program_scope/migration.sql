-- CreateEnum
CREATE TYPE "BountyPlatform" AS ENUM ('YESWEHACK', 'HACKERONE', 'INTIGRITI', 'BUGCROWD', 'OTHER', 'PRIVATE');

-- AlterTable
ALTER TABLE "Target" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "programId" TEXT;

-- AlterTable
ALTER TABLE "ScanRun" ADD COLUMN     "requiredUserAgent" TEXT;

-- CreateTable
CREATE TABLE "BountyProgram" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "platform" "BountyPlatform",
    "programUrl" TEXT,
    "rewardCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "rewardLow" DECIMAL(18,2),
    "rewardMedium" DECIMAL(18,2),
    "rewardHigh" DECIMAL(18,2),
    "rewardCritical" DECIMAL(18,2),
    "requiredUserAgent" TEXT NOT NULL,
    "outOfScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qualifying" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nonQualifying" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BountyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BountyProgram_ownerId_idx" ON "BountyProgram"("ownerId");

-- CreateIndex
CREATE INDEX "Target_programId_active_idx" ON "Target"("programId", "active");

-- AddForeignKey
ALTER TABLE "BountyProgram" ADD CONSTRAINT "BountyProgram_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_programId_fkey" FOREIGN KEY ("programId") REFERENCES "BountyProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Required even for direct database writes; no implicit UA for historical hosts.
ALTER TABLE "BountyProgram" ADD CONSTRAINT "BountyProgram_user_agent_valid"
CHECK (length(btrim("requiredUserAgent")) > 0 AND "requiredUserAgent" !~ '[^ -~]');
ALTER TABLE "BountyProgram" ADD CONSTRAINT "BountyProgram_rewards_nonnegative"
CHECK ("rewardLow" >= 0 AND "rewardMedium" >= 0 AND "rewardHigh" >= 0 AND "rewardCritical" >= 0);
-- Historical identities may share a host; only one active identity per program.
CREATE UNIQUE INDEX "Target_program_active_host_key" ON "Target" ("programId", lower("host")) WHERE "active" = true AND "programId" IS NOT NULL;
