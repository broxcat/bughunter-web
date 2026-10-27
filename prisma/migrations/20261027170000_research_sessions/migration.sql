-- Additive: historical Hunt scans/findings/reports and columns remain untouched.
CREATE TYPE "ResearchSessionStatus" AS ENUM ('CREATING', 'READY', 'ARCHIVED', 'FAILED');
CREATE TABLE "ResearchSession" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "userId" TEXT NOT NULL,
 "targetId" TEXT NOT NULL,
 "workspaceId" TEXT NOT NULL,
 "reconScanRunId" TEXT,
 "status" "ResearchSessionStatus" NOT NULL DEFAULT 'CREATING',
 "targetHost" TEXT NOT NULL,
 "programName" TEXT NOT NULL,
 "scopeMarkdown" TEXT NOT NULL,
 "files" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "exportSha256" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ResearchSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ResearchSession_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ResearchSession_reconScanRunId_fkey" FOREIGN KEY ("reconScanRunId") REFERENCES "ScanRun"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResearchSession_workspaceId_key" ON "ResearchSession"("workspaceId");
CREATE INDEX "ResearchSession_userId_createdAt_idx" ON "ResearchSession"("userId", "createdAt");
CREATE INDEX "ResearchSession_targetId_idx" ON "ResearchSession"("targetId");
CREATE INDEX "ResearchSession_reconScanRunId_idx" ON "ResearchSession"("reconScanRunId");
