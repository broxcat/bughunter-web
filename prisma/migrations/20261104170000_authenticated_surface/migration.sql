ALTER TABLE "TargetCredential" ADD COLUMN "persona" TEXT,
    ADD COLUMN "reconEnabled" BOOLEAN NOT NULL DEFAULT false;
-- Existing runs remain unknown; never label them anonymous-only after the fact.
ALTER TABLE "ScanRun" ADD COLUMN "authenticatedContextsSnapshot" JSONB,
    ADD COLUMN "authenticatedReconResult" JSONB;

CREATE TABLE "ReconSurfaceObservation" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "scopeAssetId" TEXT NOT NULL,
    "contextKey" TEXT NOT NULL,
    "contextType" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlRedacted" BOOLEAN NOT NULL DEFAULT false,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER,
    "contentType" TEXT,
    "redirect" TEXT,
    "redirectPattern" TEXT,
    "bodyHash" TEXT,
    "bodyLength" INTEGER,
    "responseClass" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    CONSTRAINT "ReconSurfaceObservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReconSurfaceObservation_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReconSurfaceObservation_scopeAssetId_fkey" FOREIGN KEY ("scopeAssetId") REFERENCES "ScopeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReconSurfaceObservation_scanRunId_contextKey_canonicalKey_key" ON "ReconSurfaceObservation"("scanRunId", "contextKey", "canonicalKey");
CREATE INDEX "ReconSurfaceObservation_scanRunId_idx" ON "ReconSurfaceObservation"("scanRunId");
CREATE INDEX "ReconSurfaceObservation_scopeAssetId_idx" ON "ReconSurfaceObservation"("scopeAssetId");
