import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { deliverScanJob } from "./scanQueue";

export type DispatchResult = { dispatch: "PENDING" | "PUBLISHED" | null };
export const dispatchSelect = { status: true, attempts: true, nextAttemptAt: true, publishedAt: true } as const;
export function publicationBackoffMs(attempts: number): number {
  return Math.min(300_000, 1000 * 2 ** Math.min(9, Math.max(0, attempts - 1)));
}

/** Serialize a short delivery attempt on the outbox row. No durable PUBLISHING
 * state/lease is needed: PostgreSQL releases locks on crash/rollback. The Redis
 * side may already have committed; the deterministic job ID reconciles that case.
 */
export async function publishScanJob(scanRunId: string, source: "http" | "dispatcher" = "http"): Promise<DispatchResult> {
  try {
    return await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "ScanJobOutbox"
        WHERE "scanRunId" = ${scanRunId} AND "status" = 'PENDING'
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= CURRENT_TIMESTAMP)
        FOR UPDATE SKIP LOCKED`;
      if (!locked.length) {
        const intent = await tx.scanJobOutbox.findUnique({ where: { scanRunId }, select: { status: true } });
        return { dispatch: intent?.status ?? null };
      }
      const intent = await tx.scanJobOutbox.findUniqueOrThrow({ where: { scanRunId }, include: { scanRun: true } });
      const run = intent.scanRun;
      const fields = { scanRunId, targetId: run.targetId, attempts: intent.attempts, jobId: run.id, source };
      // Execution already started/ended: never resurrect a scan, even after Redis
      // has evicted an old job. Settle the delivery intent using durable DB state.
      if (run.status !== "QUEUED") {
        await tx.scanJobOutbox.update({ where: { id: intent.id }, data: { status: "PUBLISHED", lastError: null, nextAttemptAt: null, publishedAt: new Date() } });
        await tx.scanRun.update({ where: { id: run.id }, data: { jobId: run.id } });
        logger.info(fields, "scan delivery reconciled from execution state");
        return { dispatch: "PUBLISHED" as const };
      }
      if (run.cancelRequestedAt) return { dispatch: "PENDING" as const }; // Maintenance/processor settles cancellation without publishing new work.
      const attempts = intent.attempts + 1;
      logger.info({ ...fields, attempts }, "scan delivery attempt");
      try {
        const delivery = await deliverScanJob({ scanRunId: run.id, targetId: run.targetId, type: run.type });
        await tx.scanRun.update({ where: { id: run.id }, data: { jobId: run.id } });
        await tx.scanJobOutbox.update({ where: { id: intent.id }, data: { status: "PUBLISHED", attempts, lastError: null, nextAttemptAt: null, publishedAt: new Date() } });
        logger.info({ ...fields, attempts }, delivery.alreadyPresent ? "scan job already present; delivery reconciled" : "scan job published");
        return { dispatch: "PUBLISHED" as const };
      } catch {
        // Never persist/log Redis error text: it can contain URLs or credentials.
        await tx.scanJobOutbox.update({ where: { id: intent.id }, data: { attempts, lastError: "QUEUE_DELIVERY_UNCONFIRMED", nextAttemptAt: new Date(Date.now() + publicationBackoffMs(attempts)) } });
        logger.warn({ ...fields, attempts }, attempts >= 5 ? "scan delivery delayed after repeated failures; retry remains scheduled" : "scan delivery unconfirmed; retry scheduled");
        return { dispatch: "PENDING" as const };
      }
    }, { maxWait: 1000, timeout: 4000 });
  } catch {
    // Creation was committed before this function. A DB failure here must not
    // turn accepted work into a misleading HTTP 500 or lose the durable intent.
    logger.warn({ scanRunId, source, code: "DISPATCH_DATABASE_UNAVAILABLE" }, "scan delivery reconciliation deferred");
    return { dispatch: "PENDING" };
  }
}
