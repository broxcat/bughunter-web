-- CreateEnum
CREATE TYPE "FindingLifecycle" AS ENUM ('CANDIDATE', 'VALIDATING', 'VALIDATED', 'REJECTED', 'READY_TO_SUBMIT', 'SUBMITTED', 'TRIAGED', 'ACCEPTED', 'DUPLICATE', 'INFORMATIVE', 'NOT_APPLICABLE', 'RESOLVED', 'RETEST_REQUIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RetestOutcome" AS ENUM ('FIX_CONFIRMED', 'STILL_REPRODUCIBLE', 'PARTIALLY_FIXED', 'CANNOT_RETEST');

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "lifecycle" "FindingLifecycle",
ADD COLUMN     "lifecycleRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "submission" JSONB;

-- CreateTable
CREATE TABLE "FindingLifecycleEvent" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "eventKey" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "previous" "FindingLifecycle",
    "state" "FindingLifecycle" NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "validation" JSONB,
    "submission" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingRetest" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "originalEvidenceIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingRetest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingRetestResult" (
    "id" TEXT NOT NULL,
    "retestId" TEXT NOT NULL,
    "outcome" "RetestOutcome" NOT NULL,
    "actorId" TEXT NOT NULL,
    "sessionReferenceId" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "conclusion" TEXT NOT NULL,
    "evidenceIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingRetestResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FindingLifecycleEvent_findingId_revision_key" ON "FindingLifecycleEvent"("findingId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "FindingLifecycleEvent_findingId_eventKey_key" ON "FindingLifecycleEvent"("findingId", "eventKey");

-- CreateIndex
CREATE INDEX "FindingRetest_findingId_createdAt_idx" ON "FindingRetest"("findingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FindingRetestResult_retestId_key" ON "FindingRetestResult"("retestId");

-- AddForeignKey
ALTER TABLE "FindingLifecycleEvent" ADD CONSTRAINT "FindingLifecycleEvent_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingRetest" ADD CONSTRAINT "FindingRetest_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingRetestResult" ADD CONSTRAINT "FindingRetestResult_retestId_fkey" FOREIGN KEY ("retestId") REFERENCES "FindingRetest"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Historical rows remain uncaptured; only subsequent creates default to CANDIDATE.
ALTER TABLE "Finding" ALTER COLUMN "lifecycle" SET DEFAULT 'CANDIDATE';
