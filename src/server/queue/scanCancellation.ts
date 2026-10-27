import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function requestScanCancellation(scanRunId: string, userId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ScanRun" WHERE id = ${scanRunId} FOR UPDATE`;
    const run = await tx.scanRun.findFirst({ where: { id: scanRunId, target: { userId, OR: [{ program: null }, { program: { ownerId: userId } }] } } });
    if (!run) return { kind: "NOT_FOUND" as const };
    if (run.status === "CANCELLED") return { kind: "CANCELLED" as const, run };
    if (["COMPLETED", "FAILED"].includes(run.status)) return { kind: "TERMINAL" as const, run };
    if (run.cancelRequestedAt) return { kind: "REQUESTED" as const, run };
    const updated = await tx.scanRun.update({ where: { id: scanRunId }, data: { cancelRequestedAt: new Date() } });
    const attempt = await tx.scanExecutionAttempt.findFirst({ where: { scanRunId, state: "RUNNING" }, select: { id: true, workerId: true } });
    logger.info({ scanRunId, attemptId: attempt?.id, workerId: attempt?.workerId, reason: "USER_CANCELLED" }, "scan cancellation requested");
    await tx.scanLog.create({ data: { scanRunId, line: "[worker] cancellation requested by user; waiting for confirmed cleanup", stream: "STDERR" } });
    return { kind: "REQUESTED" as const, run: updated };
  });
}

/** No attempt and no start under the same row lock proves there is no traffic to
 * stop. Works with Redis down: the delivered job will later see CANCELLED and exit.
 */
export async function settleQueuedCancellations(): Promise<void> {
  const queued = await prisma.scanRun.findMany({ where: { status: "QUEUED", cancelRequestedAt: { not: null }, startedAt: null }, take: 100, select: { id: true } });
  for (const run of queued) await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ScanRun" WHERE id = ${run.id} FOR UPDATE`;
    const claimed = await tx.scanRun.updateMany({ where: { id: run.id, status: "QUEUED", startedAt: null, cancelRequestedAt: { not: null }, executionAttempts: { none: {} } }, data: { status: "CANCELLED", outcome: null, error: null, finishedAt: new Date() } });
    if (claimed.count) {
      logger.info({ scanRunId: run.id, reason: "USER_CANCELLED_BEFORE_START" }, "queued scan cancellation completed");
      await tx.scanLog.create({ data: { scanRunId: run.id, line: "[worker] queued scan cancelled before execution; no network work started", stream: "STDERR" } });
    }
  });
}
