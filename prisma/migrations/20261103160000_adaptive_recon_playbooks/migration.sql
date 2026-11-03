-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReconPipelineState" ADD VALUE 'PARTIAL';
ALTER TYPE "ReconPipelineState" ADD VALUE 'BLOCKED';

-- AlterTable
ALTER TABLE "ScanRun" ADD COLUMN     "artifactVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "changeSet" JSONB,
ADD COLUMN     "reconOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reconPlan" JSONB,
ADD COLUMN     "scopeMarkdown" TEXT,
ADD COLUMN     "scopeMarkdownSha256" TEXT,
ADD COLUMN     "targetReconRunId" TEXT,
ADD COLUMN     "toolVersions" JSONB;

-- CreateTable
CREATE TABLE "TargetReconRun" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "outcome" "ScanOutcome",
    "preflight" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "scopeMarkdown" TEXT,
    "scopeMarkdownSha256" TEXT,

    CONSTRAINT "TargetReconRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconArtifact" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "scopeAssetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "scopeState" TEXT NOT NULL,
    "verification" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetReconRun_programId_createdAt_idx" ON "TargetReconRun"("programId", "createdAt");

-- CreateIndex
CREATE INDEX "ReconArtifact_scopeAssetId_kind_idx" ON "ReconArtifact"("scopeAssetId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ReconArtifact_scanRunId_kind_canonicalKey_key" ON "ReconArtifact"("scanRunId", "kind", "canonicalKey");

-- CreateIndex
CREATE INDEX "ScanRun_scopeAssetId_createdAt_idx" ON "ScanRun"("scopeAssetId", "createdAt");

-- CreateIndex
CREATE INDEX "ScanRun_targetReconRunId_idx" ON "ScanRun"("targetReconRunId");

-- AddForeignKey
ALTER TABLE "ScanRun" ADD CONSTRAINT "ScanRun_targetReconRunId_fkey" FOREIGN KEY ("targetReconRunId") REFERENCES "TargetReconRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetReconRun" ADD CONSTRAINT "TargetReconRun_programId_fkey" FOREIGN KEY ("programId") REFERENCES "BountyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconArtifact" ADD CONSTRAINT "ReconArtifact_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconArtifact" ADD CONSTRAINT "ReconArtifact_scopeAssetId_fkey" FOREIGN KEY ("scopeAssetId") REFERENCES "ScopeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TargetReconRun_one_live_program" ON "TargetReconRun"("programId") WHERE status IN ('QUEUED','RUNNING');
