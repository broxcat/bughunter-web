CREATE TYPE "TargetSessionStatus" AS ENUM ('VALID', 'INVALID', 'EXPIRED', 'UNKNOWN');
ALTER TABLE "TargetCredential"
  ADD COLUMN "sessionStatus" "TargetSessionStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "sessionCheckedAt" TIMESTAMP(3),
  ADD COLUMN "sessionExpiresAt" TIMESTAMP(3),
  ADD COLUMN "validationUrl" TEXT,
  ADD COLUMN "sessionIdentityHash" TEXT,
  ADD COLUMN "sessionCheckId" TEXT;

CREATE TYPE "FindingReviewStatus" AS ENUM ('CANDIDATE', 'EVIDENCE_REVIEW', 'CONFIRMED', 'REJECTED', 'INCONCLUSIVE');
ALTER TABLE "Finding"
  ADD COLUMN "reviewStatus" "FindingReviewStatus" NOT NULL DEFAULT 'CANDIDATE',
  ADD COLUMN "reviewEvidence" JSONB,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);
UPDATE "Finding" SET "reviewStatus" = CASE
  WHEN "gateStatus" = 'PASSED' THEN 'CONFIRMED'::"FindingReviewStatus"
  WHEN "gateStatus" = 'KILLED' THEN 'REJECTED'::"FindingReviewStatus"
  ELSE 'CANDIDATE'::"FindingReviewStatus" END;
