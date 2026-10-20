-- CreateEnum
CREATE TYPE "CredentialMode" AS ENUM ('COOKIES', 'BEARER', 'EMAIL_PASSWORD');

-- AlterTable
ALTER TABLE "TargetCredential" ADD COLUMN     "emailCipher" TEXT,
ADD COLUMN     "loginUrl" TEXT,
ADD COLUMN     "mode" "CredentialMode" NOT NULL DEFAULT 'COOKIES',
ADD COLUMN     "passwordCipher" TEXT,
ADD COLUMN     "sessionCookiesCipher" TEXT,
ADD COLUMN     "sessionRefreshedAt" TIMESTAMP(3);
