-- The Research stage is now driven directly from current Recon evidence and
-- saved AI routing. Remove the retired planning, native-console and Burp MCP
-- persistence while retaining automated Research sessions and reviewed data.

ALTER TABLE "ResearchSession" RENAME COLUMN "consoleTargetId" TO "activeTargetId";
ALTER INDEX "ResearchSession_consoleTargetId_key" RENAME TO "ResearchSession_activeTargetId_key";

ALTER TYPE "ResearchHypothesisSource" RENAME VALUE 'CODEX_WORKSPACE' TO 'AUTOMATED_RESEARCH';
ALTER TYPE "ResearchHypothesisRevisionSource" RENAME VALUE 'WORKSPACE_IMPORT' TO 'STRUCTURED_RESEARCH';

ALTER TABLE "ResearchSession"
  DROP COLUMN "publicationManifest",
  DROP COLUMN "researchPlanId",
  DROP COLUMN "workspaceId",
  DROP COLUMN "provider",
  DROP COLUMN "files",
  DROP COLUMN "exportSha256",
  DROP COLUMN "hypothesesSyncedAt",
  DROP COLUMN "hypothesesSourceSha256";

ALTER TABLE "ResearchHypothesis" DROP COLUMN "planItemId";
ALTER TABLE "ResearchCoverage" DROP COLUMN "planItemId";
ALTER TABLE "Target" DROP COLUMN "consoleDeletingAt";

DROP TABLE "ResearchReconDelivery";
DROP TABLE "ResearchReconSnapshot";
DROP TABLE "ResearchPlanItem";
DROP TABLE "ResearchPlan";

DROP TYPE "ResearchProvider";
DROP TYPE "ResearchPlanStatus";
DROP TYPE "ResearchPlanPriority";
DROP TYPE "ResearchPlanCategory";
DROP TYPE "ResearchPlanItemStatus";

UPDATE "EvidenceRecord" SET "kind" = 'RESEARCH_EVIDENCE' WHERE "kind" = 'BURP_REFERENCE';
CREATE TYPE "EvidenceKind_new" AS ENUM ('HTTP_REQUEST_RESPONSE', 'RECON_ARTIFACT', 'RESEARCH_EVIDENCE');
ALTER TABLE "EvidenceRecord" ALTER COLUMN "kind" TYPE "EvidenceKind_new" USING ("kind"::text::"EvidenceKind_new");
DROP TYPE "EvidenceKind";
ALTER TYPE "EvidenceKind_new" RENAME TO "EvidenceKind";
