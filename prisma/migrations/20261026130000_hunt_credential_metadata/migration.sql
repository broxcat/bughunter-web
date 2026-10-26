CREATE TYPE "CredentialPurpose" AS ENUM ('ACCOUNT_A', 'ACCOUNT_B', 'SESSION_COOKIE', 'JWT', 'OTHER');
ALTER TABLE "TargetCredential" ADD COLUMN "purpose" "CredentialPurpose" NOT NULL DEFAULT 'OTHER', ADD COLUMN "ownedObjectUrl" TEXT;
