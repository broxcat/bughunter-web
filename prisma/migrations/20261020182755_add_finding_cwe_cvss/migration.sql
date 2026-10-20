-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "cvssScore" DOUBLE PRECISION,
ADD COLUMN     "cvssVector" TEXT,
ADD COLUMN     "cwe" TEXT,
ADD COLUMN     "impact" TEXT,
ADD COLUMN     "remediation" TEXT;
