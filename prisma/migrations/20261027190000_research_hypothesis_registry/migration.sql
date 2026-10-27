-- CreateEnum
CREATE TYPE "ResearchHypothesisStatus" AS ENUM ('OPEN', 'BLOCKED', 'REJECTED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ResearchHypothesisConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ResearchHypothesisSource" AS ENUM ('CODEX_WORKSPACE');

-- CreateEnum
CREATE TYPE "ResearchHypothesisRevisionSource" AS ENUM ('WORKSPACE_IMPORT');

-- AlterTable
ALTER TABLE "ResearchSession" ADD COLUMN     "hypothesesSourceSha256" TEXT,
ADD COLUMN     "hypothesesSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ResearchHypothesis" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" "ResearchHypothesisStatus" NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "evidenceFor" JSONB NOT NULL,
    "evidenceAgainst" JSONB NOT NULL,
    "nextTest" TEXT NOT NULL,
    "expectedSignal" TEXT NOT NULL,
    "falsificationCondition" TEXT NOT NULL,
    "blockedReason" TEXT,
    "notes" TEXT,
    "confidence" "ResearchHypothesisConfidence",
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "ResearchHypothesisSource" NOT NULL DEFAULT 'CODEX_WORKSPACE',
    "sourceUpdatedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentSha256" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchHypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchHypothesisRevision" (
    "id" TEXT NOT NULL,
    "hypothesisId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "source" "ResearchHypothesisRevisionSource" NOT NULL DEFAULT 'WORKSPACE_IMPORT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchHypothesisRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchHypothesis_sessionId_status_idx" ON "ResearchHypothesis"("sessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchHypothesis_sessionId_externalId_key" ON "ResearchHypothesis"("sessionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchHypothesisRevision_hypothesisId_revision_key" ON "ResearchHypothesisRevision"("hypothesisId", "revision");

-- AddForeignKey
ALTER TABLE "ResearchHypothesis" ADD CONSTRAINT "ResearchHypothesis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchHypothesisRevision" ADD CONSTRAINT "ResearchHypothesisRevision_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "ResearchHypothesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
