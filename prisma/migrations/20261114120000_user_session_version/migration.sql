-- M3: server-side session revocation. Every JWT carries the version it was
-- issued under; bumping it (or deleting the user) invalidates all sessions.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
