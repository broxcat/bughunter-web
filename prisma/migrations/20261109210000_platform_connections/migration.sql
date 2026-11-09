
CREATE TABLE "PlatformConnection" (
  "userId" TEXT NOT NULL,
  "platform" "BountyPlatform" NOT NULL,
  "credentialCipher" TEXT NOT NULL,
  CONSTRAINT "PlatformConnection_pkey" PRIMARY KEY ("userId", "platform"),
  CONSTRAINT "PlatformConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
