import { WaitingError, DelayedError, type Job } from "bullmq";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { loadTargetExecution, withTargetExecution } from "@/server/execution";
import { runRecon } from "@/server/scanners/recon";
import { ScanAbortError, settlesWithin, withScanControl, type ScanStopReason } from "@/server/scanControl";
import type { ScanExecutionResult } from "@/server/scanners/result";
import { beginScanExecution, finishScanExecution, monitorScanExecution, workerIdentity, ReconCapacityError, type ExecutionCompletion } from "./executionAttempts";
import type { ScanJobData } from "./scanQueue";

type Executor = (type: ScanJobData["type"], host: string, scanRunId: string) => Promise<ScanExecutionResult>;
const execute: Executor = (type, host, id) => type === "RECON" ? runRecon(host, id) : Promise.resolve({ outcome: "UNSUPPORTED", reason: "Legacy Hunt is retired" });
export const SHUTDOWN_GRACE_MS = 5000;

/** A process owns controllers, PostgreSQL owns execution identity/exclusion.
 * Injecting an executor lets infrastructure tests use only a controlled local target.
 */
export function createScanProcessor(workerId: string, executor: Executor = execute) {
  let accepting = true;
  const active = new Map<string, ReturnType<typeof monitorScanExecution>>();
  const calls = new Set<Promise<void>>();
  const handle = async (job: Job<ScanJobData>, signal?: AbortSignal, token?: string) => {
    const { scanRunId, type, targetId } = job.data;
    if (!accepting) {
      // Acquisition and pause can race. Returning normally here would falsely
      // complete a never-started job and strand its QUEUED run after shutdown.
      const run = await prisma.scanRun.findUnique({ where: { id: scanRunId }, select: { status: true, startedAt: true, executionAttempts: { select: { id: true }, take: 1 } } }).catch(() => {
        logger.warn({ scanRunId, workerId, reason: "SHUTDOWN_EXECUTION_STATE_UNKNOWN" }, "job left for stalled recovery without acknowledging execution");
        throw new WaitingError();
      });
      if (run?.status === "QUEUED" && !run.startedAt && !run.executionAttempts.length) {
        try { await job.moveToWait(token ?? job.token); }
        catch { /* Closing/lost Redis lock: stalled recovery will consult the DB. */ }
        logger.info({ scanRunId, workerId, reason: "SHUTDOWN_BEFORE_START" }, "never-started job deferred during shutdown");
        throw new WaitingError();
      }
      return;
    }
    if (job.attemptsStarted > 1) logger.warn({ scanRunId, workerId, reason: "BULLMQ_REPLAY" }, "BullMQ invoked the processor again; automatic network replay is fenced");
    let attempt;
    try { attempt = await beginScanExecution(scanRunId, workerId); }
    catch(e) { if(e instanceof ReconCapacityError){await job.moveToDelayed(Date.now()+1000,token??job.token);throw new DelayedError();}throw e; }
    if (!attempt) return;
    const monitor = monitorScanExecution(attempt), control = monitor.control;
    active.set(scanRunId, monitor);
    const externalStop = () => control.abort("WORKER_SHUTDOWN");
    if (!accepting || signal?.aborted) externalStop();
    signal?.addEventListener("abort", externalStop, { once: true });
    let work: Promise<ScanExecutionResult> | undefined;
    let completion: ExecutionCompletion;
    let failed: unknown;
    let onAbort: () => void = () => {};
    try {
      work = withScanControl(control, async () => {
        await monitor.ready;
        control.assertActive();
        const run = await prisma.scanRun.findUniqueOrThrow({ where: { id: scanRunId }, include: { target: { include: { scope: true } }, scopeAsset: true } });
        if (type === "HUNT" || run.type === "HUNT") return { outcome: "UNSUPPORTED" as const, reason: "Legacy HUNT is retired. Use the automated Research stage instead." };
        if (type === "VALIDATE" || run.type === "VALIDATE") return { outcome: "UNSUPPORTED" as const, reason: "VALIDATE scan type is not supported: validation engine is not implemented." };
        if (run.type !== type || run.targetId !== targetId) throw new Error("Scan job identity mismatch");
        // Scope/policy are revalidated on every real start, after winning the claim.
        const execution = run.reconPlan ? await loadTargetExecution(targetId, 'RECON', run.reconPlan as unknown as import('@/lib/reconPlanner').ReconPlan) : await loadTargetExecution(targetId, 'RECON');
        if (run.scopeAssetId && (!run.scopeAsset?.active || execution.scopeAsset?.id !== run.scopeAssetId)) throw new Error('Scope asset authorization changed since the scan was queued');
        const policy = run.scopeAssetSnapshot as { type?: string; assetValue?: string } | null;
        if (execution.scopeAsset && policy?.type && policy.assetValue) execution.scopeAsset = { ...execution.scopeAsset, type: policy.type, assetValue: policy.assetValue };
        control.assertActive();
        await prisma.scanRun.update({ where: { id: scanRunId }, data: { requiredUserAgent: execution.requiredUserAgent } });
        return withTargetExecution(execution, () => executor(type, run.target.host, scanRunId));
      });
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(control.signal.reason);
        if (control.signal.aborted) onAbort(); else control.signal.addEventListener("abort", onAbort, { once: true });
      });
      const result = await Promise.race([work, aborted]);
      completion = { state: result.outcome === "FAILED" || result.outcome === "UNSUPPORTED" ? "FAILED" : "COMPLETED", result };
    } catch (error) {
      failed = error;
      completion = { state: "FAILED", result: { outcome: "FAILED", reason: "Scan execution failed before normal completion" } };
    } finally {
      // Cancellation is complete only after the actual processes, HTTP bodies and
      // browser contexts have stopped; rejecting the JS promise alone is insufficient.
      const clean = await control.cleanup() || await control.cleanup(true);
      if (control.signal.aborted && work) await settlesWithin(work.catch(() => {}), 1000); // Let scanner finally blocks persist their partial reports.
      if (control.signal.aborted || !clean) {
        const reason = control.signal.reason instanceof ScanAbortError ? control.signal.reason.reason : "EXECUTION_LOST";
        completion = { state: clean && reason === "USER_CANCELLED" ? "CANCELLED" : "INTERRUPTED", reason: clean ? reason : "CLEANUP_UNCONFIRMED" };
      }
      monitor.stop();
      control.signal.removeEventListener("abort", onAbort);
      signal?.removeEventListener("abort", externalStop);
    }
    try { await finishScanExecution(attempt.id, workerId, completion!); }
    finally { active.delete(scanRunId); }
    try{const {publishReconHistory}=await import('../recon/history');await publishReconHistory(scanRunId);}catch{logger.warn({scanRunId,reason:'RECON_HISTORY_PUBLICATION_DEFERRED'},'Surface history publication will retry');}
    const parent=await prisma.scanRun.findUnique({where:{id:scanRunId},select:{targetReconRunId:true,scopeAssetId:true}});
    if(parent?.targetReconRunId)try{const {reconcileTargetRecon}=await import('../recon/targetRuns');await reconcileTargetRecon(parent.targetReconRunId);}catch{logger.warn({scanRunId,reason:'RECON_INTELLIGENCE_PUBLICATION_DEFERRED'},'Recon evidence committed; intelligence publication will retry');}
    else if(parent?.scopeAssetId)try{const {materializeAssetRecon}=await import('../scopeMarkdown');await materializeAssetRecon(scanRunId);}catch{logger.warn({scanRunId,reason:'SCOPE_INTELLIGENCE_PUBLICATION_DEFERRED'},'Scope intelligence publication deferred');}
    if (failed && !control.signal.aborted) throw failed; // BullMQ attempts stays 1.
  };
  return {
    process(job: Job<ScanJobData>, signal?: AbortSignal, token?: string): Promise<void> {
      const pending = handle(job, signal, token);
      calls.add(pending);
      void pending.finally(() => calls.delete(pending)).catch(() => {});
      return pending;
    },
    interrupt(scanRunId: string, reason: ScanStopReason) { active.get(scanRunId)?.control.abort(reason); },
    stopAccepting() { accepting = false; },
    async shutdown(graceMs = SHUTDOWN_GRACE_MS) {
      accepting = false;
      for (const monitor of active.values()) monitor.control.abort("WORKER_SHUTDOWN");
      if (await settlesWithin(Promise.allSettled([...calls]), graceMs)) return;
      await Promise.all([...active.values()].map(async monitor => {
        monitor.control.abort("WORKER_SHUTDOWN");
        const clean = await monitor.control.cleanup(true, 1000);
        monitor.stop();
        await settlesWithin(finishScanExecution(monitor.control.identity.attemptId, workerId, { state: "INTERRUPTED", reason: clean ? "WORKER_SHUTDOWN_GRACE_EXPIRED" : "CLEANUP_UNCONFIRMED" }), 1000);
      }));
    },
  };
}
const defaultProcessor = createScanProcessor(workerIdentity());
export const processScan = (job: Job<ScanJobData>) => defaultProcessor.process(job);
