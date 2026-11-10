ALTER TABLE "Target" DROP CONSTRAINT "Target_programId_fkey",
  ADD CONSTRAINT "Target_programId_fkey" FOREIGN KEY ("programId") REFERENCES "BountyProgram"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchSession" DROP CONSTRAINT "ResearchSession_targetId_fkey",
  ADD CONSTRAINT "ResearchSession_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchFindingPromotion" DROP CONSTRAINT "ResearchFindingPromotion_findingId_fkey",
  ADD CONSTRAINT "ResearchFindingPromotion_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchFindingPromotion" DROP CONSTRAINT "ResearchFindingPromotion_hypothesisId_fkey",
  ADD CONSTRAINT "ResearchFindingPromotion_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "ResearchHypothesis"(id) ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ReportItem_findingId_idx" ON "ReportItem"("findingId");

CREATE OR REPLACE FUNCTION guard_program_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."programId" IS DISTINCT FROM OLD."programId" THEN
    IF NEW."programId" IS NULL THEN RETURN NEW; END IF;
    PERFORM 1 FROM "BountyProgram" WHERE id=NEW."programId" AND "deletingAt" IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Program unavailable'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER guard_program_target ON "Target";
CREATE TRIGGER guard_program_target BEFORE INSERT OR UPDATE OF "programId" ON "Target"
  FOR EACH ROW EXECUTE FUNCTION guard_program_target();

-- Append a new active version, leaving historical JSON and columns intact.
-- Draft false used to mean "not reviewed". Only source evidence of an explicit
-- automation prohibition preserves that value (the same phrases as intake).
WITH latest AS (
  SELECT DISTINCT ON ("programId") * FROM "ProgramExecutionPolicy" ORDER BY "programId", version DESC
), drafts AS (
  SELECT l.*, concat_ws(E'\n', p."rulesOfEngagement", l.policy->'sourceSnapshot'->>'rules',
    l.policy->'sourceSnapshot'->>'sourceDocument', l.policy->'sourceSnapshot'->'ruleDecisions'::text,
    l.policy->'sourceSnapshot'->'legacy'::text) AS source
  FROM latest l JOIN "BountyProgram" p ON p.id=l."programId"
  WHERE l.policy->>'reviewState' IN ('BACKFILL_DRAFT', 'IMPORT_DRAFT')
)
INSERT INTO "ProgramExecutionPolicy" ("programId", version, policy)
SELECT "programId", version + 1,
  (policy - 'reviewState') || jsonb_build_object('automationAllowed',
    CASE WHEN policy->>'automationAllowed' = 'false' AND source ~*
      '\m((do not|must not|never|refrain from)[[:space:]]+(use|using|run|running)[[:space:]]+(any[[:space:]]+)?automat(ed|ic)[[:space:]]+(tools|scans|scanners|testing)|no[[:space:]]+automated[[:space:]]+(tools|scanning|testing|scans)|(automation|automated (tools|scanning|testing))[[:space:]]+(is |are )?(strictly )?(forbidden|prohibited|not (allowed|permitted)))\M'
    THEN false ELSE true END)
FROM drafts;

UPDATE "TargetCampaign" SET state='READY', reason=NULL, "requestedAt"=CURRENT_TIMESTAMP,
  "retryAt"=NULL, "updatedAt"=CURRENT_TIMESTAMP
WHERE state='BLOCKED' AND (reason ILIKE '%review%' OR reason ILIKE '%unrepresented%'
  OR reason LIKE 'Confirm an execution policy%');
