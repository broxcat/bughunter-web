-- Additive, metadata-only advisory planning. Existing sessions remain uncaptured.
ALTER TABLE "ResearchSession" ADD COLUMN "researchPlanId" TEXT;
ALTER TABLE "ResearchHypothesis" ADD COLUMN "planItemId" TEXT;
ALTER TABLE "ResearchReconSnapshot" ADD COLUMN "researchPlanId" TEXT;

-- CreateEnum
CREATE TYPE "ResearchPlanStatus" AS ENUM ('CURRENT', 'SUPERSEDED', 'STALE');

-- CreateEnum
CREATE TYPE "ResearchPlanPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ResearchPlanCategory" AS ENUM ('AUTHORIZATION', 'AUTHENTICATION', 'SESSION_MANAGEMENT', 'API', 'API_VERSIONING', 'GRAPHQL', 'FILE_UPLOAD', 'SERVER_SIDE_REQUEST', 'REDIRECT_HANDLING', 'BUSINESS_LOGIC', 'PRIVILEGED_FUNCTIONS', 'ACCOUNT_LIFECYCLE', 'TENANT_ISOLATION', 'INPUT_HANDLING');

-- CreateEnum
CREATE TYPE "ResearchPlanItemStatus" AS ENUM ('READY', 'NOT_APPLICABLE_BY_PROGRAM');

-- CreateTable
CREATE TABLE "ResearchPlan" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "scopeAssetId" TEXT,
    "scanRunId" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "methodologyVersion" TEXT NOT NULL,
    "assessmentMode" "AssessmentMode",
    "status" "ResearchPlanStatus" NOT NULL DEFAULT 'CURRENT',
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "ResearchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "category" "ResearchPlanCategory" NOT NULL,
    "priority" "ResearchPlanPriority" NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "methodology" TEXT NOT NULL,
    "surfaceRefs" JSONB NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "contextRefs" JSONB NOT NULL,
    "runtimeSignals" JSONB NOT NULL,
    "sourceSignals" JSONB NOT NULL,
    "sourceEvidenceRefs" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "evidenceStrength" INTEGER NOT NULL,
    "status" "ResearchPlanItemStatus" NOT NULL DEFAULT 'READY',
    "isNew" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchPlan_targetId_createdAt_idx" ON "ResearchPlan"("targetId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchPlan_programId_idx" ON "ResearchPlan"("programId");

-- CreateIndex
CREATE INDEX "ResearchPlan_scanRunId_idx" ON "ResearchPlan"("scanRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchPlan_targetId_sourceFingerprint_key" ON "ResearchPlan"("targetId", "sourceFingerprint");

-- CreateIndex
CREATE INDEX "ResearchPlanItem_planId_priority_idx" ON "ResearchPlanItem"("planId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchPlanItem_planId_stableKey_key" ON "ResearchPlanItem"("planId", "stableKey");

-- AddForeignKey
ALTER TABLE "ResearchSession" ADD CONSTRAINT "ResearchSession_researchPlanId_fkey" FOREIGN KEY ("researchPlanId") REFERENCES "ResearchPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchHypothesis" ADD CONSTRAINT "ResearchHypothesis_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "ResearchPlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchReconSnapshot" ADD CONSTRAINT "ResearchReconSnapshot_researchPlanId_fkey" FOREIGN KEY ("researchPlanId") REFERENCES "ResearchPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlan" ADD CONSTRAINT "ResearchPlan_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlan" ADD CONSTRAINT "ResearchPlan_programId_fkey" FOREIGN KEY ("programId") REFERENCES "BountyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlan" ADD CONSTRAINT "ResearchPlan_scopeAssetId_fkey" FOREIGN KEY ("scopeAssetId") REFERENCES "ScopeAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlan" ADD CONSTRAINT "ResearchPlan_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchPlanItem" ADD CONSTRAINT "ResearchPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ResearchPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ResearchHypothesis_planItemId_idx" ON "ResearchHypothesis"("planItemId");
-- Serialize plan publication in the service; this constraint also fences independent writers.
CREATE UNIQUE INDEX "ResearchPlan_one_current_target" ON "ResearchPlan"("targetId") WHERE status='CURRENT';
