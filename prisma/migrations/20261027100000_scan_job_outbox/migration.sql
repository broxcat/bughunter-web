-- Additive only: no inferred dispatch state or idempotency keys for historical runs.
CREATE TYPE "ScanJobDispatchStatus" AS ENUM ('PENDING', 'PUBLISHED');
CREATE TABLE "ScanJobOutbox" (
  "id" TEXT NOT NULL,
  "scanRunId" TEXT NOT NULL,
  "status" "ScanJobDispatchStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScanJobOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScanJobOutbox_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScanJobOutbox_scanRunId_key" ON "ScanJobOutbox"("scanRunId");
CREATE INDEX "ScanJobOutbox_status_nextAttemptAt_idx" ON "ScanJobOutbox"("status", "nextAttemptAt");
CREATE TABLE "ScanRequestKey" (
  "userId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "scanRunId" TEXT NOT NULL,
  CONSTRAINT "ScanRequestKey_pkey" PRIMARY KEY ("userId", "key"),
  CONSTRAINT "ScanRequestKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScanRequestKey_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScanRequestKey_scanRunId_key" ON "ScanRequestKey"("scanRunId");
