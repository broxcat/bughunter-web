-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReconPipelineState" ADD VALUE 'COMPLETED_WITH_FALLBACK';
ALTER TYPE "ReconPipelineState" ADD VALUE 'SKIPPED_NOT_APPLICABLE';
ALTER TYPE "ReconPipelineState" ADD VALUE 'SKIPPED_UNSUPPORTED';
ALTER TYPE "ReconPipelineState" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "ScanRun" ADD COLUMN     "toolManifest" JSONB;

-- AlterTable
ALTER TABLE "ReconPipelineStep" ADD COLUMN     "capability" TEXT,
ADD COLUMN     "details" JSONB;
