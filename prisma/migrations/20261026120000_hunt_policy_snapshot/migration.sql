-- Additive: historical runs have no invented policy snapshot.
ALTER TABLE "ScanRun" ADD COLUMN "huntSnapshot" JSONB;
