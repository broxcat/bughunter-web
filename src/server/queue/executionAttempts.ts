import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Prisma, ScanExecutionAttempt, ScanExecutionAttemptState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { ScanExecutionResult } from "@/server/scanners/result";
import { ScanControl } from "@/server/scanControl";

export const HEARTBEAT_INTERVAL_MS = 2000;
export const HEARTBEAT_STALE_MS = 30_000;
export const EXECUTION_LEASE_MS = 10_000; // Fail closed before any other worker can declare us stale.
export function workerIdentity(): string { return `${hostname()}:${process.pid}:${randomUUID()}`; }
export const attemptSelect = { id: true, state: true, reason: true, startedAt: true, finishedAt: true } as const;
export const executionSelect = { orderBy: { startedAt: "desc" as const }, take: 1, select: attemptSelect };
async function lockScan(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "ScanRun" WHERE id = ${id} FOR UPDATE`;
}
async function event(tx: Prisma.TransactionClient, attempt: Pick<ScanExecutionAttempt, "id" | "scanRunId" | "workerId">, reason: string, message: string) {
  const fields = { scanRunId: attempt.scanRunId, attemptId: attempt.id, workerId: attempt.workerId, reason };
  logger.info(fields, message);
  await tx.scanLog.create({ data: { scanRunId: attempt.scanRunId, line: `[worker] ${message}; reason=${reason}; attempt=${attempt.id}`, stream: ["STARTED", "COMPLETED", "USER_CANCELLED"].includes(reason) ? "STDOUT" : "STDERR" } });
}
async function interrupt(tx: Prisma.TransactionClient, attempt: ScanExecutionAttempt, reason: string) {
  const changed = await tx.scanExecutionAttempt.updateMany({ where: { id: attempt.id, state: "RUNNING", heartbeatAt: attempt.heartbeatAt }, data: { state: "INTERRUPTED", reason, finishedAt: new Date() } });
  if (!changed.count) return false;
  await tx.scanRun.updateMany({ where: { id: attempt.scanRunId, status: "RUNNING" }, data: { status: "FAILED", outcome: attempt.usefulWorkAt ? "PARTIAL" : "FAILED", error: "Previous execution was interrupted; automatic network replay refused.", finishedAt: new Date() } });
  await event(tx, attempt, reason, "execution interrupted; automatic network replay disabled");
  return true;
}
export async function beginScanExecution(scanRunId: string, workerId: string): Promise<ScanExecutionAttempt | null> {
  return prisma.$transaction(async tx => {
    await lockScan(tx, scanRunId);
    const run = await tx.scanRun.findUnique({ where: { id: scanRunId }, include: { executionAttempts: { orderBy: { startedAt: "desc" }, take: 1 } } });
    if (!run) throw new Error("ScanRun not found");
    const previous = run.executionAttempts[0];
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) {
      if (previous) logger.info({ scanRunId, attemptId: previous.id, workerId, reason: "TERMINAL_REPLAY_REFUSED" }, "terminal execution replay refused");
      return null;
    }
    if (previous || run.status !== "QUEUED" || run.startedAt) {
      if (previous?.state === "RUNNING" && previous.heartbeatAt.getTime() <= Date.now() - HEARTBEAT_STALE_MS) await interrupt(tx, previous, "STALE_HEARTBEAT_ON_REPLAY");
      logger.warn({ scanRunId, attemptId: previous?.id, workerId, reason: "AUTOMATIC_REPLAY_REFUSED" }, "job replay refused: execution already started");
      await tx.scanLog.create({ data: { scanRunId, line: "[worker] job replay refused: previous execution already started; automatic network replay disabled", stream: "STDERR" } });
      // Unsupported legacy jobs cannot perform network work, including old RUNNING rows.
      if (!previous && run.type === "VALIDATE") {
        await tx.scanRun.update({ where: { id: scanRunId }, data: { status: "FAILED", outcome: "UNSUPPORTED", error: "VALIDATE engine is not implemented", finishedAt: new Date() } });
        await tx.scanLog.create({ data: { scanRunId, line: "[worker] VALIDATE is unsupported; validation engine is not implemented", stream: "STDERR" } });
      }
      return null;
    }
    if (run.cancelRequestedAt) {
      await tx.scanRun.update({ where: { id: scanRunId }, data: { status: "CANCELLED", outcome: null, finishedAt: new Date(), error: null } });
      return null;
    }
    const claim = await tx.scanRun.updateMany({ where: { id: scanRunId, status: "QUEUED", startedAt: null, cancelRequestedAt: null }, data: { status: "RUNNING", outcome: null, startedAt: new Date(), finishedAt: null, error: null } });
    if (!claim.count) return null;
    const attempt = await tx.scanExecutionAttempt.create({ data: { scanRunId, workerId } });
    await event(tx, attempt, "STARTED", "execution attempt started");
    return attempt;
  });
}

export async function reconcileScanExecutions(now = new Date()): Promise<number> {
  const stale = await prisma.scanExecutionAttempt.findMany({ where: { state: "RUNNING", heartbeatAt: { lte: new Date(now.getTime() - HEARTBEAT_STALE_MS) } }, take: 100, orderBy: { heartbeatAt: "asc" } });
  let count = 0;
  for (const candidate of stale) {
    count += Number(await prisma.$transaction(async tx => {
      await lockScan(tx, candidate.scanRunId);
      const fresh = await tx.scanExecutionAttempt.findUnique({ where: { id: candidate.id } });
      if (!fresh || fresh.state !== "RUNNING" || fresh.heartbeatAt.getTime() > now.getTime() - HEARTBEAT_STALE_MS) return false;
      logger.warn({ scanRunId: fresh.scanRunId, attemptId: fresh.id, workerId: fresh.workerId, reason: "STALE_HEARTBEAT" }, "execution heartbeat expired");
      return interrupt(tx, fresh, "STALE_HEARTBEAT");
    }));
  }
  return count;
}

export type ExecutionCompletion = { state: "COMPLETED" | "FAILED"; result: ScanExecutionResult } | { state: "CANCELLED" | "INTERRUPTED"; reason: string };
/** Called only after the owner has drained its network resources. Compare-and-set
 * on the attempt fences late results from old processors/reconciled executions.
 */
export async function finishScanExecution(attemptId: string, workerId: string, completion: ExecutionCompletion): Promise<void> {
  await prisma.$transaction(async tx => {
    const identity = await tx.scanExecutionAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: { scanRunId: true } });
    await lockScan(tx, identity.scanRunId);
    const attempt = await tx.scanExecutionAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const run = await tx.scanRun.findUniqueOrThrow({ where: { id: attempt.scanRunId } });
    if (attempt.workerId !== workerId) return;
    let state: ScanExecutionAttemptState = completion.state;
    // Normal completion has no active resources left, so a concurrent cancellation
    // request wins until this transaction locks the run. Worker loss is interrupted.
    if (run.cancelRequestedAt && state !== "INTERRUPTED") state = "CANCELLED";
    const reason = state === "CANCELLED" ? "USER_CANCELLED" : "reason" in completion ? completion.reason : completion.result.reason ?? null;
    const claimed = await tx.scanExecutionAttempt.updateMany({ where: { id: attemptId, state: "RUNNING", workerId }, data: { state, reason, finishedAt: new Date() } });
    if (!claimed.count) return;
    const result = "result" in completion ? completion.result : null;
    await tx.scanRun.updateMany({ where: { id: run.id, status: "RUNNING" }, data: {
      status: state === "CANCELLED" ? "CANCELLED" : state === "INTERRUPTED" || state === "FAILED" ? "FAILED" : "COMPLETED",
      outcome: state === "CANCELLED" ? null : state === "INTERRUPTED" ? attempt.usefulWorkAt ? "PARTIAL" : "FAILED" : result!.outcome,
      error: state === "CANCELLED" ? null : state === "INTERRUPTED" ? "Execution interrupted; automatic network replay disabled." : result?.reason ?? null,
      finishedAt: new Date(),
    } });
    await event(tx, attempt, state === "CANCELLED" ? "USER_CANCELLED" : reason ?? state, state === "CANCELLED" ? "scan cancellation completed after cleanup" : `execution attempt ${state.toLowerCase()}`);
  });
}

export function monitorScanExecution(attempt: ScanExecutionAttempt) {
  const marks = new Map<string, Promise<void>>();
  let leaseUntil = Date.now() + EXECUTION_LEASE_MS;
  const control = new ScanControl({ scanRunId: attempt.scanRunId, attemptId: attempt.id, workerId: attempt.workerId }, kind => {
    if (Date.now() > leaseUntil) throw new Error("Execution heartbeat lease expired");
    if (!marks.has(kind)) marks.set(kind, (async () => {
      const saved = await prisma.scanExecutionAttempt.updateMany({ where: { id: attempt.id, workerId: attempt.workerId, state: "RUNNING" }, data: { [kind]: new Date() } });
      if (!saved.count) throw new Error("Execution fenced");
    })());
    return marks.get(kind)!;
  });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout>;
  let pulse: Promise<void> = Promise.resolve();
  const arm = () => { leaseUntil = Date.now() + EXECUTION_LEASE_MS; clearTimeout(watchdog); watchdog = setTimeout(() => control.abort("HEARTBEAT_LOST"), EXECUTION_LEASE_MS); };
  arm();
  const tick = async () => {
    try {
      if (Date.now() > leaseUntil) { control.abort("HEARTBEAT_LOST"); return; }
      const saved = await prisma.scanExecutionAttempt.updateMany({ where: { id: attempt.id, state: "RUNNING", workerId: attempt.workerId }, data: { heartbeatAt: new Date() } });
      if (!saved.count) { control.abort("EXECUTION_LOST"); return; }
      if (!stopped && !control.signal.aborted) arm();
      const run = await prisma.scanRun.findUnique({ where: { id: attempt.scanRunId }, select: { cancelRequestedAt: true } });
      if (run?.cancelRequestedAt) control.abort("USER_CANCELLED");
    } catch { control.abort("HEARTBEAT_LOST"); }
    finally { if (!stopped && !control.signal.aborted) timer = setTimeout(() => { pulse = tick(); }, HEARTBEAT_INTERVAL_MS); }
  };
  pulse = tick();
  return { control, ready: pulse, stop() { stopped = true; clearTimeout(timer); clearTimeout(watchdog); }, async flush() { await pulse; } };
}
