-- CreateEnum
CREATE TYPE "FindingConfidence" AS ENUM ('CANDIDATE', 'PROVEN');

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "confidence" "FindingConfidence" DEFAULT 'CANDIDATE';
