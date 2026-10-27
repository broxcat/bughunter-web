CREATE TYPE "ScanOutcome" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED', 'UNSUPPORTED');

-- No default or backfill: historical results are unknown.
ALTER TABLE "ScanRun" ADD COLUMN "outcome" "ScanOutcome";
