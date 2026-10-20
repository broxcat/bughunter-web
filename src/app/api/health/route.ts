// Public health check. No auth — used by Docker/compose healthchecks and load
// balancers to decide if this instance can serve traffic. Reports liveness of
// the two hard dependencies: Postgres (via Prisma) and Redis (via the shared
// ioredis connection). Returns 200 when both are up, 503 otherwise, naming
// which dependency is down.
//
// NOTE: for this route to be reachable without a login, it must be in the
// middleware public allowlist (middleware.ts, owned by Agent S).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/server/queue/connection";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let db: "up" | "down" = "down";
  let redisStatus: "up" | "down" = "down";

  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    db = "down";
  }

  try {
    await redis.ping();
    redisStatus = "up";
  } catch {
    redisStatus = "down";
  }

  if (db === "up" && redisStatus === "up") {
    logger.info({ db, redis: redisStatus }, "health check ok");
    return NextResponse.json({ status: "ok", db, redis: redisStatus }, { status: 200 });
  }

  logger.warn({ db, redis: redisStatus }, "health check failed — dependency down");
  return NextResponse.json(
    { status: "error", db, redis: redisStatus },
    { status: 503 },
  );
}
