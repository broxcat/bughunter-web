-- Repair explicit wildcard rules added through the existing Scope editor after
-- the program workflow migration. Never promote automatic discoveries to rules.
UPDATE "BountyProgram" p
SET "scopeRules" = ARRAY(
  SELECT DISTINCT rule FROM (
    SELECT unnest(p."scopeRules") AS rule
    UNION
    SELECT t.host FROM "Target" t JOIN "Scope" s ON s.id=t."scopeId"
    WHERE t."programId"=p.id AND t."userId"=p."ownerId" AND s."userId"=p."ownerId"
      AND t.active=true AND t."contextOnly"=false AND t."discoverySource" IS NULL
      AND s.status='APPROVED' AND s."hostPattern"=t.host
      AND t.host LIKE '*.%'
  ) rules ORDER BY rule
), "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
 SELECT 1 FROM "Target" t JOIN "Scope" s ON s.id=t."scopeId"
 WHERE t."programId"=p.id AND t."userId"=p."ownerId" AND s."userId"=p."ownerId"
   AND t.active=true AND t."contextOnly"=false AND t."discoverySource" IS NULL
   AND s.status='APPROVED' AND s."hostPattern"=t.host AND t.host LIKE '*.%'
   AND NOT (t.host = ANY(p."scopeRules"))
);
