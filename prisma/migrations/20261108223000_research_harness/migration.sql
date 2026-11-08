CREATE TABLE "ResearchModelRouting" (
    "userId" TEXT NOT NULL,
    "fastProvider" "AiProvider",
    "fastModel" VARCHAR(200),
    "reviewProvider" "AiProvider",
    "reviewModel" VARCHAR(200),
    CONSTRAINT "ResearchModelRouting_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "ResearchModelRouting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ResearchHarnessRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestKey" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchHarnessRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchHarnessRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchHarnessRun_stage_check" CHECK ("stage" IN ('map','hunt','validate','trace')),
    CONSTRAINT "ResearchHarnessRun_status_check" CHECK ("status" IN ('RUNNING','SUCCEEDED','FAILED'))
);

CREATE UNIQUE INDEX "ResearchHarnessRun_sessionId_requestKey_key" ON "ResearchHarnessRun"("sessionId", "requestKey");
CREATE INDEX "ResearchHarnessRun_sessionId_stage_subject_createdAt_idx" ON "ResearchHarnessRun"("sessionId", "stage", "subject", "createdAt");
