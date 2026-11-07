-- Existing READY/historical workspaces retain their original contract; no backfill.
ALTER TABLE "ResearchSession" ADD COLUMN "publicationManifest" JSONB;
