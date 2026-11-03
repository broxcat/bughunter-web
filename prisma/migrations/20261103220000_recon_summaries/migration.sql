-- AlterTable
ALTER TABLE "Target" ADD COLUMN     "consoleDeletingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ScopeAsset" ADD COLUMN     "formatSource" TEXT NOT NULL DEFAULT 'AUTO';

-- CreateTable
CREATE TABLE "ReconSummary" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "scopeAssetId" TEXT,
    "scanRunId" TEXT,
    "targetReconRunId" TEXT,
    "automaticKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "model" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "content" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),

    CONSTRAINT "ReconSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReconSummary_automaticKey_key" ON "ReconSummary"("automaticKey");

-- CreateIndex
CREATE INDEX "ReconSummary_status_createdAt_idx" ON "ReconSummary"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReconSummary_programId_createdAt_idx" ON "ReconSummary"("programId", "createdAt");

-- CreateIndex
CREATE INDEX "ReconSummary_scopeAssetId_createdAt_idx" ON "ReconSummary"("scopeAssetId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReconSummary" ADD CONSTRAINT "ReconSummary_programId_fkey" FOREIGN KEY ("programId") REFERENCES "BountyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconSummary" ADD CONSTRAINT "ReconSummary_scopeAssetId_fkey" FOREIGN KEY ("scopeAssetId") REFERENCES "ScopeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconSummary" ADD CONSTRAINT "ReconSummary_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconSummary" ADD CONSTRAINT "ReconSummary_targetReconRunId_fkey" FOREIGN KEY ("targetReconRunId") REFERENCES "TargetReconRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
