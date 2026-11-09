
CREATE TABLE "ProgramExecutionPolicy" (
    "programId" TEXT NOT NULL,
    "version" INTEGER NOT NULL CHECK ("version" > 0),
    "policy" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgramExecutionPolicy_pkey" PRIMARY KEY ("programId", "version"),
    CONSTRAINT "ProgramExecutionPolicy_programId_fkey" FOREIGN KEY ("programId")
        REFERENCES "BountyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "HunterIdentity" (
    "userId" TEXT NOT NULL,
    "userAgent" TEXT,
    "headers" JSONB NOT NULL,
    CONSTRAINT "HunterIdentity_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "HunterIdentity_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
