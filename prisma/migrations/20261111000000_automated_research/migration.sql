ALTER TYPE "ScanType" ADD VALUE 'RESEARCH';
ALTER TYPE "TargetCampaignStatus" ADD VALUE 'RESEARCH_RUNNING';

ALTER TABLE "ScanRun" ADD COLUMN "researchKey" TEXT,
  ADD COLUMN "researchSourceId" TEXT,
  ADD COLUMN "researchHandoffId" TEXT,
  ADD COLUMN "executedResearchPlanId" TEXT,
  ADD COLUMN "researchResults" JSONB;

CREATE UNIQUE INDEX "ScanRun_researchKey_key" ON "ScanRun"("researchKey");
CREATE INDEX "ScanRun_researchSourceId_idx" ON "ScanRun"("researchSourceId");
CREATE INDEX "ScanRun_researchHandoffId_idx" ON "ScanRun"("researchHandoffId");

ALTER TABLE "ScanRun" ADD CONSTRAINT "ScanRun_researchSourceId_fkey"
  FOREIGN KEY ("researchSourceId") REFERENCES "ScanRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScanRun" ADD CONSTRAINT "ScanRun_executedResearchPlanId_fkey"
  FOREIGN KEY ("executedResearchPlanId") REFERENCES "ResearchPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
