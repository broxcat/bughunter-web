-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('HTTP_REQUEST_RESPONSE', 'RECON_ARTIFACT', 'BURP_REFERENCE', 'RESEARCH_EVIDENCE');

-- CreateEnum
CREATE TYPE "EvidenceRelationRole" AS ENUM ('SUPPORTS', 'REFUTES', 'CONTEXT');

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "sessionId" TEXT,
    "sessionReferenceId" TEXT,
    "kind" "EvidenceKind" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "redactionStatus" TEXT NOT NULL,
    "contentSha256" TEXT,
    "metadata" JSONB NOT NULL,
    "reconArtifactId" TEXT,
    "reconArtifactReferenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceHypothesis" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "hypothesisId" TEXT,
    "hypothesisReferenceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "role" "EvidenceRelationRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceHypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceFinding" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "findingId" TEXT,
    "findingReferenceId" TEXT NOT NULL,
    "role" "EvidenceRelationRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceReport" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "reportId" TEXT,
    "reportReferenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceCoverage" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "coverageEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenceRecord_targetId_createdAt_idx" ON "EvidenceRecord"("targetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_targetId_sourceKey_key" ON "EvidenceRecord"("targetId", "sourceKey");

-- CreateIndex
CREATE INDEX "EvidenceHypothesis_hypothesisId_idx" ON "EvidenceHypothesis"("hypothesisId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceHypothesis_evidenceId_hypothesisReferenceId_revisio_key" ON "EvidenceHypothesis"("evidenceId", "hypothesisReferenceId", "revision", "role");

-- CreateIndex
CREATE INDEX "EvidenceFinding_findingId_idx" ON "EvidenceFinding"("findingId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceFinding_evidenceId_findingReferenceId_role_key" ON "EvidenceFinding"("evidenceId", "findingReferenceId", "role");

-- CreateIndex
CREATE INDEX "EvidenceReport_reportId_idx" ON "EvidenceReport"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceReport_evidenceId_reportReferenceId_key" ON "EvidenceReport"("evidenceId", "reportReferenceId");

-- CreateIndex
CREATE INDEX "EvidenceCoverage_coverageEventId_idx" ON "EvidenceCoverage"("coverageEventId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceCoverage_evidenceId_coverageEventId_key" ON "EvidenceCoverage"("evidenceId", "coverageEventId");

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_reconArtifactId_fkey" FOREIGN KEY ("reconArtifactId") REFERENCES "ReconArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceHypothesis" ADD CONSTRAINT "EvidenceHypothesis_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceHypothesis" ADD CONSTRAINT "EvidenceHypothesis_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "ResearchHypothesis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFinding" ADD CONSTRAINT "EvidenceFinding_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFinding" ADD CONSTRAINT "EvidenceFinding_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceReport" ADD CONSTRAINT "EvidenceReport_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceReport" ADD CONSTRAINT "EvidenceReport_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceCoverage" ADD CONSTRAINT "EvidenceCoverage_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceCoverage" ADD CONSTRAINT "EvidenceCoverage_coverageEventId_fkey" FOREIGN KEY ("coverageEventId") REFERENCES "ResearchCoverageEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
