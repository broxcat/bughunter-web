-- Additive: no renaming, backfill, rewrite or deletion of historical workspaces.
ALTER TABLE "ResearchSession" ADD COLUMN "consoleTargetId" TEXT;
CREATE UNIQUE INDEX "ResearchSession_consoleTargetId_key" ON "ResearchSession"("consoleTargetId");
ALTER TABLE "ResearchSession" ADD CONSTRAINT "ResearchSession_console_target_identity" CHECK ("consoleTargetId" IS NULL OR "consoleTargetId" = "targetId");
