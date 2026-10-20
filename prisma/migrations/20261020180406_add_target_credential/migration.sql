-- CreateTable
CREATE TABLE "TargetCredential" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cookiesCipher" TEXT,
    "headerCipher" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetCredential_targetId_idx" ON "TargetCredential"("targetId");

-- AddForeignKey
ALTER TABLE "TargetCredential" ADD CONSTRAINT "TargetCredential_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;
