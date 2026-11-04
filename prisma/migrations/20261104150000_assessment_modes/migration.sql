CREATE TYPE "AssessmentMode" AS ENUM ('BLACK_BOX', 'WHITE_BOX');
CREATE TYPE "AssessmentSourceKind" AS ENUM ('GIT_REPOSITORY', 'SOURCE_ARCHIVE', 'API_SPECIFICATION', 'ARCHITECTURE_DOCUMENTATION', 'CONFIGURATION', 'OTHER');

ALTER TABLE "BountyProgram" ADD COLUMN "assessmentMode" "AssessmentMode" NOT NULL DEFAULT 'BLACK_BOX';
-- Historical execution snapshots deliberately remain NULL.
ALTER TABLE "TargetReconRun" ADD COLUMN "assessmentModeSnapshot" "AssessmentMode",
    ADD COLUMN "assessmentSourcesSnapshot" JSONB;
ALTER TABLE "ScanRun" ADD COLUMN "assessmentModeSnapshot" "AssessmentMode",
    ADD COLUMN "assessmentSourcesSnapshot" JSONB;

CREATE TABLE "AssessmentSource" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "AssessmentSourceKind" NOT NULL,
    "locator" TEXT NOT NULL,
    "reference" TEXT,
    "includePaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "excludePaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssessmentSource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssessmentSource_programId_fkey" FOREIGN KEY ("programId") REFERENCES "BountyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AssessmentSource_programId_active_idx" ON "AssessmentSource"("programId", "active");
