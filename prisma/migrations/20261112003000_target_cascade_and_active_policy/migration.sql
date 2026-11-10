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

-- BEGIN GENERATED AUTOMATION DETECTION (npm run policy:generate-detection)
CREATE OR REPLACE FUNCTION program_is_reporting_restriction(source TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT coalesce(bool_and(btrim(sentence) ~* $pattern$^\s*(?:[-*#>•"«“(0-9.)]+\s*)*(?:(?:the|any|all|these|those|only|les?|des?|ces|tous|toutes|seuls?|seules?|nos|vos|un|une|a|an|our|your|each|every|this|that|la|ce|cet|cette|chaque|tout|toute)\s+)*(?:reports?|submissions?|findings?|results?|outputs?|rapports?|soumissions?|r[eé]sultats?)($|[^a-zà-ÿ])$pattern$), false)
  FROM regexp_split_to_table(coalesce(source, ''), $pattern$[\r\n]+|(?<=[.!?;])\s+$pattern$) sentence
  WHERE btrim(sentence) <> ''
$function$;

CREATE OR REPLACE FUNCTION program_automation_prohibition(source TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT btrim(sentence) FROM regexp_split_to_table(coalesce(source, ''), $pattern$[\r\n]+|(?<=[.!?;])\s+$pattern$)
    WITH ORDINALITY AS parts(sentence, position)
  WHERE sentence ~* $pattern$(^|[^a-zà-ÿ])(?:(?:no|(?:do\s+not|don['’]t|must\s+not|never)(?:\s+(?:use|run|perform|conduct|launch))?|(?:please\s+)?refrain\s+from(?:\s+(?:using|running|performing))?|(?:please\s+)?avoid(?:\s+(?:using|running|performing))?|(?:ne\s+(?:pas|jamais)\s+(?:utiliser|lancer|ex[eé]cuter|effectuer)|n['’]utilisez\s+(?:pas|jamais)|ne\s+(?:lancez|faites)\s+(?:pas|jamais))\s+(?:d['’]\s*|de\s+|des\s+|les\s+)?|(?:pas|aucun(?:e)?)\s+(?:d['’]\s*|de\s+)?|(?:veuillez\s+)?(?:vous\s+)?absten(?:ez-vous|ir)\s+d['’](?:utiliser|ex[eé]cuter)\s+(?:des?\s+|d['’]\s*)?|(?:interdiction|interdit)\s+d['’](?:utiliser|ex[eé]cuter|effectuer)\s+(?:des?\s+|d['’]\s*)?)\s*(?:any\s+)?(?:(?:automated|automatic)\s+(?:(?:vulnerability|security|web)\s+)?(?:scanning\s+tools?|tools?|tooling|scans?|scanners?|scanning|tests?|testing)|automation|(?:outils?|scanners?|scans?|tests?)\s+(?:de\s+(?:scan|scanning|test|s[eé]curit[eé])\s+)?(?:automatiques?|automatis[eé](?:e|s|es)?)|automatisation)|(?:(?:automated|automatic)\s+(?:(?:vulnerability|security|web)\s+)?(?:scanning\s+tools?|tools?|tooling|scans?|scanners?|scanning|tests?|testing)|automation|(?:outils?|scanners?|scans?|tests?)\s+(?:de\s+(?:scan|scanning|test|s[eé]curit[eé])\s+)?(?:automatiques?|automatis[eé](?:e|s|es)?)|automatisation)\s+(?:(?:(?:is|are)\s+)?(?:(?:strictly|explicitly|expressly)\s+)?(?:forbidden|prohibited|banned|disallowed|not\s+(?:allowed|permitted|authori[sz]ed))|must\s+not\s+be\s+used|(?:(?:est|sont)\s+)?(?:(?:strictement|formellement|express[eé]ment)\s+)?(?:interdit(?:e|s|es)?|prohib[eé](?:e|s|es)?|non\s+autoris[eé](?:e|s|es)?)|(?:n['’]est|ne\s+sont)\s+pas\s+(?:autoris[eé](?:e|s|es)?|permis(?:e|s|es)?)))($|[^a-zà-ÿ])$pattern$
    AND sentence !~* $pattern$^\s*(?:[-*#>•"«“(0-9.)]+\s*)*(?:(?:the|any|all|these|those|only|les?|des?|ces|tous|toutes|seuls?|seules?|nos|vos|un|une|a|an|our|your|each|every|this|that|la|ce|cet|cette|chaque|tout|toute)\s+)*(?:reports?|submissions?|findings?|results?|outputs?|rapports?|soumissions?|r[eé]sultats?)($|[^a-zà-ÿ])$pattern$
  ORDER BY position LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION program_automation_source(program_rules TEXT, snapshot JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT concat_ws(chr(10), program_rules, (
    SELECT string_agg(field.value #>> '{}', chr(10) ORDER BY paths.position, field.ordinality)
    FROM unnest(ARRAY['$.rules', '$.sourceDocument', '$.programSections.description', '$.legacy.programRules', '$.unrepresentedRules[*]', '$.ruleDecisions[*].text', '$.legacy.scopes[*].rulesOfEngagement', '$.legacy.scopes[*].scopeDetails', '$.legacy.scopes[*].outOfScope'])
      WITH ORDINALITY AS paths(path, position)
    CROSS JOIN LATERAL jsonb_path_query(coalesce(snapshot, '{}'::jsonb), paths.path::jsonpath)
      WITH ORDINALITY AS field(value, ordinality)
    WHERE jsonb_typeof(field.value) = 'string'
  ))
$function$;
-- END GENERATED AUTOMATION DETECTION

-- Append a new active version, leaving historical JSON and columns intact.
-- Draft false used to mean "not reviewed". Only source evidence of an explicit
-- automation prohibition preserves that value (the same phrases as intake).
WITH latest AS (
  SELECT DISTINCT ON ("programId") * FROM "ProgramExecutionPolicy" ORDER BY "programId", version DESC
), drafts AS (
  SELECT l.*, program_automation_source(p."rulesOfEngagement", l.policy->'sourceSnapshot') AS source
  FROM latest l JOIN "BountyProgram" p ON p.id=l."programId"
  WHERE l.policy->>'reviewState' IN ('BACKFILL_DRAFT', 'IMPORT_DRAFT')
), classified AS (
  SELECT drafts.*, coalesce(CASE WHEN NOT program_is_reporting_restriction(policy->>'automationProhibition')
      THEN nullif(policy->>'automationProhibition', '') END, program_automation_prohibition(source)) AS prohibition
  FROM drafts
)
INSERT INTO "ProgramExecutionPolicy" ("programId", version, policy)
SELECT "programId", version + 1,
  (policy - 'reviewState') || jsonb_build_object(
    'automationAllowed', prohibition IS NULL,
    'automationProhibition', prohibition)
FROM classified;

UPDATE "TargetCampaign" SET state='READY', reason=NULL, "requestedAt"=CURRENT_TIMESTAMP,
  "retryAt"=NULL, "updatedAt"=CURRENT_TIMESTAMP
WHERE state='BLOCKED' AND (reason ILIKE '%review%' OR reason ILIKE '%unrepresented%'
  OR reason LIKE 'Confirm an execution policy%');
