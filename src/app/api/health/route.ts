import { withApiBoundary } from '@/lib/apiBoundary';
// Public readiness probe. Never wait on BullMQ's unbounded shared Redis retry queue.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRedisConnection } from "@/server/queue/connection";
import { logger } from "@/lib/logger";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DEPENDENCY_TIMEOUT_MS = 1500;
async function dependencyUp(work: () => Promise<unknown>): Promise<"up" | "down"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Dependency deadline")), DEPENDENCY_TIMEOUT_MS); })]);
    return "up";
  } catch { return "down"; } finally { clearTimeout(timer); }
}
 async function handleGET(_req: Request) {
  void _req;
  // Dedicated, nonretrying connection: a health request must not queue a PING
  // forever or accumulate commands on the worker's persistent connection.
  const client = createRedisConnection({ maxRetriesPerRequest: 0, enableOfflineQueue: false, connectTimeout: 1000, retryStrategy: () => null });
  const [db, redis] = await Promise.all([
    dependencyUp(() => prisma.$queryRaw`SELECT 1`),
    dependencyUp(async () => { await client.connect(); await client.ping(); }),
  ]);
  // Dispose on success, failure and when connect outlives the deadline.
  client.disconnect();
  const ok = db === "up" && redis === "up";
  logger[ok ? "info" : "warn"]({ db, redis }, ok ? "health check ok" : "health check failed — dependency down");
  return NextResponse.json({ status: ok ? "ok" : "error", db, redis }, { status: ok ? 200 : 503 });
}

export const GET = withApiBoundary(handleGET, []);
