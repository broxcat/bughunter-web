-- AlterEnum
ALTER TYPE "ReportPlatform" ADD VALUE 'YESWEHACK';

-- AlterTable
ALTER TABLE "Scope" ADD COLUMN     "accessInfo" TEXT,
ADD COLUMN     "contactInfo" TEXT,
ADD COLUMN     "disclosurePolicy" TEXT,
ADD COLUMN     "eligibilityCriteria" TEXT,
ADD COLUMN     "legalTerms" TEXT,
ADD COLUMN     "outOfScope" TEXT,
ADD COLUMN     "platform" "ReportPlatform",
ADD COLUMN     "reportingFormat" TEXT,
ADD COLUMN     "rewardsTable" TEXT,
ADD COLUMN     "rulesOfEngagement" TEXT,
ADD COLUMN     "safeHarbor" TEXT,
ADD COLUMN     "scopeDetails" TEXT,
ADD COLUMN     "vendorResponseSla" TEXT;
