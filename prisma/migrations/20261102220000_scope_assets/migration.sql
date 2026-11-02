-- CreateEnum
CREATE TYPE "ScopeAssetFormat" AS ENUM ('URL', 'WILDCARD_DOMAIN', 'DOMAIN', 'SUBDOMAIN', 'HOSTNAME', 'IP', 'CIDR');

-- CreateEnum
CREATE TYPE "ScopeAssetType" AS ENUM ('API', 'WEB_APPLICATION', 'WILDCARD', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetValue" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ReconPipelineState" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "Target" ADD COLUMN     "discoveredFromAssetId" TEXT,
ADD COLUMN     "scopeAssetId" TEXT;

-- AlterTable
ALTER TABLE "ScanRun" ADD COLUMN     "assetResults" JSONB,
ADD COLUMN     "scopeAssetId" TEXT,
ADD COLUMN     "scopeAssetSnapshot" JSONB;

-- CreateTable
CREATE TABLE "ScopeAsset" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "originalValue" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "format" "ScopeAssetFormat" NOT NULL,
    "type" "ScopeAssetType" NOT NULL,
    "typeSource" TEXT NOT NULL DEFAULT 'HEURISTIC',
    "assetValue" "AssetValue" NOT NULL DEFAULT 'MEDIUM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconPipelineStep" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "state" "ReconPipelineState" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ReconPipelineStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScopeAsset_programId_active_idx" ON "ScopeAsset"("programId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeAsset_programId_normalizedValue_key" ON "ScopeAsset"("programId", "normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "ReconPipelineStep_scanRunId_name_key" ON "ReconPipelineStep"("scanRunId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Target_scopeAssetId_key" ON "Target"("scopeAssetId");

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_scopeAssetId_fkey" FOREIGN KEY ("scopeAssetId") REFERENCES "ScopeAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_discoveredFromAssetId_fkey" FOREIGN KEY ("discoveredFromAssetId") REFERENCES "ScopeAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRun" ADD CONSTRAINT "ScanRun_scopeAssetId_fkey" FOREIGN KEY ("scopeAssetId") REFERENCES "ScopeAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeAsset" ADD CONSTRAINT "ScopeAsset_programId_fkey" FOREIGN KEY ("programId") REFERENCES "BountyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconPipelineStep" ADD CONSTRAINT "ReconPipelineStep_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve every legacy identity/result. Infer only metadata from existing rules
-- and active host identities; historical execution-time policy stays unknown.
INSERT INTO "ScopeAsset" (id,"programId","originalValue","normalizedValue",format,type,"typeSource","assetValue",active,"createdAt","updatedAt")
SELECT 'asset_' || md5(p.id || ':' || rules.value), p.id, rules.value, rules.value,
  (CASE WHEN rules.value LIKE '*.%' THEN 'WILDCARD_DOMAIN' WHEN array_length(string_to_array(rules.value,'.'),1)>2 THEN 'SUBDOMAIN' ELSE 'DOMAIN' END)::"ScopeAssetFormat",
  (CASE WHEN rules.value LIKE '*.%' THEN 'WILDCARD' WHEN rules.value LIKE 'api.%' THEN 'API' ELSE 'WEB_APPLICATION' END)::"ScopeAssetType",
  'BACKFILL','MEDIUM',true,p."createdAt",p."updatedAt"
FROM "BountyProgram" p CROSS JOIN LATERAL (
  SELECT unnest(p."scopeRules") AS value
  UNION SELECT t.host FROM "Target" t WHERE t."programId"=p.id AND t.active AND NOT t."contextOnly" AND t."discoverySource" IS NULL
) rules
WHERE rules.value ~ '^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$'
ON CONFLICT ("programId","normalizedValue") DO NOTHING;
UPDATE "Target" t SET "scopeAssetId"=a.id FROM "ScopeAsset" a
WHERE t."programId"=a."programId" AND t.host=a."normalizedValue" AND t.active AND NOT t."contextOnly";
UPDATE "ScanRun" r SET "scopeAssetId"=t."scopeAssetId" FROM "Target" t
WHERE r."targetId"=t.id AND r.type='RECON' AND t."scopeAssetId" IS NOT NULL;
