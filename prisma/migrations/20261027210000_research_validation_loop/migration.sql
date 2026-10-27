-- Additive only. Historical v1 rows retain null structured proof/authorization.
ALTER TYPE "ResearchHypothesisStatus" ADD VALUE 'TESTING';
ALTER TABLE "ResearchSession" ADD COLUMN "authorizationSnapshot" JSONB;
ALTER TABLE "ResearchHypothesis" ADD COLUMN "researchData" JSONB;
CREATE TABLE "ResearchFindingPromotion" (
  "id" TEXT NOT NULL,
  "hypothesisId" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "hypothesisRevision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResearchFindingPromotion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResearchFindingPromotion_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "ResearchHypothesis"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResearchFindingPromotion_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResearchFindingPromotion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResearchFindingPromotion_hypothesisId_key" ON "ResearchFindingPromotion"("hypothesisId");
CREATE UNIQUE INDEX "ResearchFindingPromotion_findingId_key" ON "ResearchFindingPromotion"("findingId");
CREATE INDEX "ResearchFindingPromotion_userId_idx" ON "ResearchFindingPromotion"("userId");
