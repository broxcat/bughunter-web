-- CreateTable
CREATE TABLE "ReconHistoryRun" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "scopeAssetReferenceId" TEXT NOT NULL,
    "scanRunId" TEXT,
    "scanReferenceId" TEXT NOT NULL,
    "runCreatedAt" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReconHistoryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconSurface" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "scopeAssetReferenceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconSurface_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconSurfaceSeen" (
    "id" TEXT NOT NULL,
    "surfaceId" TEXT NOT NULL,
    "historyId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "sourceRefs" TEXT[],

    CONSTRAINT "ReconSurfaceSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReconHistoryRun_scanRunId_key" ON "ReconHistoryRun"("scanRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconHistoryRun_scanReferenceId_key" ON "ReconHistoryRun"("scanReferenceId");

-- CreateIndex
CREATE INDEX "ReconHistoryRun_targetId_scopeAssetReferenceId_runCreatedAt_idx" ON "ReconHistoryRun"("targetId", "scopeAssetReferenceId", "runCreatedAt");

-- CreateIndex
CREATE INDEX "ReconSurface_targetId_scopeAssetReferenceId_idx" ON "ReconSurface"("targetId", "scopeAssetReferenceId");

-- CreateIndex
CREATE INDEX "ReconSurfaceSeen_surfaceId_idx" ON "ReconSurfaceSeen"("surfaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconSurfaceSeen_historyId_surfaceId_key" ON "ReconSurfaceSeen"("historyId", "surfaceId");

-- AddForeignKey
ALTER TABLE "ReconHistoryRun" ADD CONSTRAINT "ReconHistoryRun_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconHistoryRun" ADD CONSTRAINT "ReconHistoryRun_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconSurface" ADD CONSTRAINT "ReconSurface_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconSurfaceSeen" ADD CONSTRAINT "ReconSurfaceSeen_surfaceId_fkey" FOREIGN KEY ("surfaceId") REFERENCES "ReconSurface"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconSurfaceSeen" ADD CONSTRAINT "ReconSurfaceSeen_historyId_fkey" FOREIGN KEY ("historyId") REFERENCES "ReconHistoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

