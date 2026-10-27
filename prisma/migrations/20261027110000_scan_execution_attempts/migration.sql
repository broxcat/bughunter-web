-- Additive; do not backfill attempts or cancellation requests for historical scans.
ALTER TABLE "ScanRun" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
CREATE TYPE "ScanExecutionAttemptState" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED');
CREATE TABLE "ScanExecutionAttempt" (
  "id" TEXT NOT NULL,
  "scanRunId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "state" "ScanExecutionAttemptState" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "networkStartedAt" TIMESTAMP(3),
  "usefulWorkAt" TIMESTAMP(3),
  "reason" TEXT,
  CONSTRAINT "ScanExecutionAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScanExecutionAttempt_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScanExecutionAttempt_scanRunId_idx" ON "ScanExecutionAttempt"("scanRunId");
CREATE INDEX "ScanExecutionAttempt_state_heartbeatAt_idx" ON "ScanExecutionAttempt"("state", "heartbeatAt");
-- Defence in depth; the ScanRun row lock also fences all starts and finalization.
CREATE UNIQUE INDEX "ScanExecutionAttempt_one_running" ON "ScanExecutionAttempt"("scanRunId") WHERE "state" = 'RUNNING';
