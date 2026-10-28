ALTER TABLE "BountyProgram" ADD COLUMN "scopeRules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "rulesOfEngagement" TEXT, ADD COLUMN "deletingAt" TIMESTAMP(3);
ALTER TABLE "Target" ADD COLUMN "contextOnly" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "discoverySource" TEXT, ADD COLUMN "discoveredAt" TIMESTAMP(3), ADD COLUMN "discoveredByScanRunId" TEXT;
ALTER TABLE "ScanExecutionAttempt" ADD COLUMN "cleanupConfirmedAt" TIMESTAMP(3);
UPDATE "BountyProgram" p SET "scopeRules" = ARRAY(SELECT DISTINCT lower(t.host) FROM "Target" t WHERE t."programId"=p.id AND t.active=true ORDER BY lower(t.host));
CREATE UNIQUE INDEX "Target_program_context_key" ON "Target" ("programId") WHERE "contextOnly"=true;
CREATE TABLE "HostDiscovery" (
 "id" TEXT PRIMARY KEY, "scanRunId" TEXT NOT NULL REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "host" TEXT NOT NULL, "source" TEXT NOT NULL, "state" TEXT NOT NULL CHECK ("state" IN ('VALIDATED','EXCLUDED','OUT_OF_SCOPE')),
 "added" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "HostDiscovery_scanRunId_host_key" ON "HostDiscovery" ("scanRunId","host");
-- Serialize deletion against resource creation, even across application replicas.
CREATE FUNCTION guard_program_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."programId" IS NOT NULL THEN
  PERFORM 1 FROM "BountyProgram" WHERE id=NEW."programId" AND "deletingAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program unavailable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_program_target BEFORE INSERT OR UPDATE ON "Target" FOR EACH ROW EXECUTE FUNCTION guard_program_target();
CREATE FUNCTION guard_program_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM "BountyProgram" p JOIN "Target" t ON t."programId"=p.id WHERE t.id=NEW."targetId" AND p."deletingAt" IS NULL FOR SHARE OF p;
 IF NOT FOUND AND EXISTS (SELECT 1 FROM "Target" WHERE id=NEW."targetId" AND "programId" IS NOT NULL) THEN RAISE EXCEPTION 'Program unavailable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_program_scan BEFORE INSERT ON "ScanRun" FOR EACH ROW EXECUTE FUNCTION guard_program_execution();
CREATE TRIGGER guard_program_research BEFORE INSERT ON "ResearchSession" FOR EACH ROW EXECUTE FUNCTION guard_program_execution();
