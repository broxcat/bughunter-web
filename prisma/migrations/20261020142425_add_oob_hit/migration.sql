-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "oobToken" TEXT;

-- CreateTable
CREATE TABLE "OobHit" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceIp" TEXT,
    "method" TEXT NOT NULL,
    "rawHeaders" JSONB,

    CONSTRAINT "OobHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OobHit_token_idx" ON "OobHit"("token");
