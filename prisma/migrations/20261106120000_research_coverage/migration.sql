-- CreateEnum
CREATE TYPE "ResearchCoverageState" AS ENUM ('NOT_TESTED', 'IN_PROGRESS', 'COVERED_NO_ISSUE_OBSERVED', 'INTERESTING', 'BLOCKED', 'HYPOTHESIS_OPEN', 'FINDING', 'NEEDS_RETEST');

-- CreateTable
CREATE TABLE "ResearchCoverage" (
    "scopeAssetReferenceId" TEXT,
    "planItemReferenceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "scopeAssetId" TEXT,
    "planItemId" TEXT,
    "objectiveKey" TEXT NOT NULL,
    "coverageKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "contextKey" TEXT NOT NULL,
    "contextLabel" TEXT NOT NULL,
    "comparisonKey" TEXT,
    "comparisonLabel" TEXT,
    "contextRunId" TEXT NOT NULL,
    "testKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "state" "ResearchCoverageState" NOT NULL DEFAULT 'NOT_TESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchCoverageEvent" (
    "id" TEXT NOT NULL,
    "coverageId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" "ResearchCoverageState" NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sessionId" TEXT,
    "sessionReferenceId" TEXT NOT NULL,
    "hypothesisReferenceId" TEXT,
    "hypothesisTestId" TEXT,
    "findingReferenceId" TEXT,

    CONSTRAINT "ResearchCoverageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchCoverage_targetId_objectiveKey_idx" ON "ResearchCoverage"("targetId", "objectiveKey");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCoverage_targetId_coverageKey_key" ON "ResearchCoverage"("targetId", "coverageKey");

-- CreateIndex
CREATE INDEX "ResearchCoverageEvent_coverageId_createdAt_idx" ON "ResearchCoverageEvent"("coverageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCoverageEvent_targetId_eventKey_key" ON "ResearchCoverageEvent"("targetId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCoverageEvent_coverageId_revision_key" ON "ResearchCoverageEvent"("coverageId", "revision");

-- AddForeignKey
ALTER TABLE "ResearchCoverage" ADD CONSTRAINT "ResearchCoverage_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCoverage" ADD CONSTRAINT "ResearchCoverage_scopeAssetId_fkey" FOREIGN KEY ("scopeAssetId") REFERENCES "ScopeAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCoverage" ADD CONSTRAINT "ResearchCoverage_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "ResearchPlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCoverageEvent" ADD CONSTRAINT "ResearchCoverageEvent_coverageId_fkey" FOREIGN KEY ("coverageId") REFERENCES "ResearchCoverage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchCoverageEvent" ADD CONSTRAINT "ResearchCoverageEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
