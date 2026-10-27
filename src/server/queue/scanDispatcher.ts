import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { publishScanJob } from "./scanJobPublisher";

export const DISPATCH_BATCH_SIZE = 10;
export const DISPATCH_INTERVAL_MS = 2000;
export async function dispatchPendingScanJobs(): Promise<void> {
  const pending = await prisma.scanJobOutbox.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: DISPATCH_BATCH_SIZE,
    select: { scanRunId: true, createdAt: true },
  });
  if (pending.length) logger.info({ count: pending.length, oldestAgeMs: Date.now() - Math.min(...pending.map(p => p.createdAt.getTime())) }, "resuming pending scan deliveries");
  await Promise.all(pending.map(p => publishScanJob(p.scanRunId, "dispatcher")));
}

/** Started by the standalone worker, never by a Next.js route. No overlapping
 * batches in this process; row locks and job IDs handle multiple processes.
 */
export function startScanDispatcher(intervalMs = DISPATCH_INTERVAL_MS): { close(): Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void>;
  const tick = async () => {
    try { await dispatchPendingScanJobs(); }
    catch { logger.warn({ code: "DISPATCH_DATABASE_UNAVAILABLE" }, "scan dispatcher will retry"); }
    finally { if (!stopped) timer = setTimeout(() => { inFlight = tick(); }, intervalMs); }
  };
  inFlight = tick();
  return { async close() { stopped = true; clearTimeout(timer); await inFlight; } };
}
