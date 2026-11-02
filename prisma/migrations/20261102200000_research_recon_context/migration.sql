CREATE TABLE "ResearchReconSnapshot" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "summarySha256" TEXT NOT NULL,
  "context" JSONB NOT NULL,
  "summary" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchReconSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ResearchReconDelivery" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "provider" "ResearchProvider" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchReconDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResearchReconSnapshot_sessionId_sourceFingerprint_key" ON "ResearchReconSnapshot"("sessionId", "sourceFingerprint");
CREATE INDEX "ResearchReconSnapshot_sessionId_createdAt_idx" ON "ResearchReconSnapshot"("sessionId", "createdAt");
CREATE INDEX "ResearchReconDelivery_sessionId_createdAt_idx" ON "ResearchReconDelivery"("sessionId", "createdAt");
ALTER TABLE "ResearchReconSnapshot" ADD CONSTRAINT "ResearchReconSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchReconDelivery" ADD CONSTRAINT "ResearchReconDelivery_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchReconDelivery" ADD CONSTRAINT "ResearchReconDelivery_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ResearchReconSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
