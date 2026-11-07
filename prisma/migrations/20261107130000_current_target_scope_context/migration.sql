-- Separate cache avoids changing BountyProgram.updatedAt (Research policy identity).
CREATE TABLE "TargetScopeContext" (
    "programId" TEXT NOT NULL,
    "policyFingerprint" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "rendererVersion" INTEGER NOT NULL,
    "markdown" TEXT NOT NULL,
    "markdownSha256" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TargetScopeContext_pkey" PRIMARY KEY ("programId"),
    CONSTRAINT "TargetScopeContext_programId_fkey" FOREIGN KEY ("programId") REFERENCES "BountyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
