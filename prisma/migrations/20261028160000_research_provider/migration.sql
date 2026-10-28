-- Additive: all existing Research sessions retain Codex and its native history.
CREATE TYPE "ResearchProvider" AS ENUM ('codex', 'claude');
ALTER TABLE "ResearchSession" ADD COLUMN "provider" "ResearchProvider" NOT NULL DEFAULT 'codex';
