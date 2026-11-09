CREATE TYPE "TargetCampaignStatus" AS ENUM ('READY','RECON_RUNNING','RESEARCH_PENDING','MONITORING','PAUSED','BLOCKED','FAILED');

ALTER TABLE "TargetReconRun" ADD COLUMN "campaignKey" TEXT;
CREATE UNIQUE INDEX "TargetReconRun_campaignKey_key" ON "TargetReconRun"("campaignKey");

CREATE TABLE "TargetCampaign" (
  "programId" TEXT NOT NULL,
  "state" "TargetCampaignStatus" NOT NULL DEFAULT 'READY',
  "cycle" INTEGER NOT NULL DEFAULT 0,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "reconRunId" TEXT,
  "handoffRunId" TEXT,
  "requestedAt" TIMESTAMP(3),
  "nextCycleAt" TIMESTAMP(3),
  "retryAt" TIMESTAMP(3),
  "intervalMinutes" INTEGER,
  "lastSyncAt" TIMESTAMP(3),
  "source" JSONB,
  "pendingAssets" JSONB NOT NULL DEFAULT '[]',
  "reason" TEXT,
  "continuing" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TargetCampaign_pkey" PRIMARY KEY ("programId"),
  CONSTRAINT "TargetCampaign_programId_fkey" FOREIGN KEY ("programId") REFERENCES "BountyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TargetCampaign_state_requestedAt_idx" ON "TargetCampaign"("state","requestedAt");
CREATE INDEX "TargetCampaign_nextCycleAt_idx" ON "TargetCampaign"("nextCycleAt");
CREATE INDEX "TargetCampaign_retryAt_idx" ON "TargetCampaign"("retryAt");
CREATE INDEX "TargetCampaign_lastSyncAt_idx" ON "TargetCampaign"("lastSyncAt");
