ALTER TABLE "ScanRun" ADD COLUMN "huntReport" JSONB, ADD COLUMN "reconCorpus" JSONB;
ALTER TABLE "Finding" ADD COLUMN "huntMetadata" JSONB;
ALTER TABLE "ScanRun" ADD COLUMN "approvedHuntTechniques" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
