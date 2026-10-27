import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { ScanJobData } from "@/server/queue/scanQueue";
import type { ScanExecutionAttempt } from "@prisma/client";
const mocks = vi.hoisted(() => ({ tx: vi.fn(), find: vi.fn(), update: vi.fn(), claim: vi.fn(), attemptFind: vi.fn(), attemptCreate: vi.fn(), attemptUpdate: vi.fn(), attemptList: vi.fn(), execution: vi.fn(), recon: vi.fn(), hunt: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.tx, scanRun: { findUnique: mocks.find, findUniqueOrThrow: mocks.find, update: mocks.update, updateMany: mocks.claim }, scanExecutionAttempt: { findUnique: mocks.attemptFind, findUniqueOrThrow: mocks.attemptFind, create: mocks.attemptCreate, updateMany: mocks.attemptUpdate, findMany: mocks.attemptList }, scanLog: { create: mocks.log } } }));
vi.mock("@/server/execution", () => ({ loadTargetExecution: mocks.execution, withTargetExecution: (_ctx: unknown, work: () => unknown) => work() }));
vi.mock("@/server/scanners/recon", () => ({ runRecon: mocks.recon }));
vi.mock("@/server/scanners/hunt", () => ({ runHunt: mocks.hunt }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
import { prisma } from "@/lib/prisma";
import { createScanProcessor } from "@/server/queue/processScan";
import { beginScanExecution, reconcileScanExecutions, HEARTBEAT_STALE_MS, HEARTBEAT_INTERVAL_MS } from "@/server/queue/executionAttempts";
import { currentScanControl } from "@/server/scanControl";
const target = { id: "target", host: "example.test", scope: { status: "APPROVED" } };
const job = (type: ScanJobData["type"]) => ({ data: { scanRunId: "run", targetId: "target", type } }) as Job<ScanJobData>;
let run: { id: string; status: string; type: string; targetId: string; target: typeof target; startedAt: Date | null; cancelRequestedAt: Date | null; outcome: string | null; error?: string; finishedAt?: Date; reconCorpus: object };
let attempts: ScanExecutionAttempt[];
let processor: ReturnType<typeof createScanProcessor>;
beforeEach(() => {
  vi.resetAllMocks(); attempts = [];
  run = { id: "run", status: "QUEUED", type: "RECON", targetId: "target", target, startedAt: null, cancelRequestedAt: null, outcome: null, reconCorpus: { observed: true } };
  // A serialized transaction fixture models row locking; real PostgreSQL tests
  // separately verify the SQL exclusion and crash/replay behaviour.
  let tail = Promise.resolve();
  mocks.tx.mockImplementation(work => { const next = tail.then(() => work({ ...prisma, $queryRaw: async () => [{ id: "run" }] })); tail = next.catch(() => {}); return next; });
  mocks.find.mockImplementation(async () => ({ ...run, executionAttempts: [...attempts] }));
  mocks.update.mockImplementation(async ({ data }) => Object.assign(run, data));
  mocks.claim.mockImplementation(async ({ where, data }) => {
    if (run.status !== where.status || where.cancelRequestedAt === null && run.cancelRequestedAt !== null) return { count: 0 };
    Object.assign(run, data); return { count: 1 };
  });
  mocks.attemptCreate.mockImplementation(async ({ data }) => {
    const attempt = { id: "attempt", ...data, state: "RUNNING", startedAt: new Date(), heartbeatAt: new Date(), finishedAt: null, reason: null, usefulWorkAt: null, networkStartedAt: null };
    attempts.push(attempt); return { ...attempt };
  });
  mocks.attemptFind.mockImplementation(async () => ({ ...attempts[0] }));
  mocks.attemptList.mockImplementation(async () => attempts.filter(a => a.state === "RUNNING" && a.heartbeatAt.getTime() <= Date.now() - HEARTBEAT_STALE_MS));
  mocks.attemptUpdate.mockImplementation(async ({ where, data }) => {
    const a = attempts[0];
    if (!a || a.id !== where.id || a.state !== where.state || where.workerId && a.workerId !== where.workerId || where.heartbeatAt && a.heartbeatAt.getTime() !== where.heartbeatAt.getTime()) return { count: 0 };
    Object.assign(a, data); return { count: 1 };
  });
  mocks.execution.mockImplementation(async () => { if (run.target.scope.status !== "APPROVED") throw new Error("Scope not APPROVED"); return { targetId: "target", requiredUserAgent: "Test/1" }; });
  processor = createScanProcessor("worker-A");
});
afterEach(async () => { await processor.shutdown(10); vi.useRealTimers(); });
async function previous(stale: boolean, useful = false) {
  await beginScanExecution("run", "previous-worker");
  attempts[0].heartbeatAt = new Date(Date.now() - (stale ? HEARTBEAT_STALE_MS + 1 : 0));
  if (useful) attempts[0].usefulWorkAt = new Date();
}
describe("worker execution outcome persistence", () => {
  it.each(["QUEUED", "RUNNING"])("rejects legacy %s VALIDATE without tools", async status => {
    Object.assign(run, { status, type: "VALIDATE" });
    await processor.process(job("VALIDATE"));
    expect(run).toMatchObject({ status: "FAILED", outcome: "UNSUPPORTED", finishedAt: expect.any(Date), error: expect.stringContaining("not implemented") });
    expect(mocks.recon).not.toHaveBeenCalled(); expect(mocks.hunt).not.toHaveBeenCalled(); expect(mocks.execution).not.toHaveBeenCalled();
  });
  for (const type of ["RECON", "HUNT"] as const) {
    it.each(["SUCCESS", "PARTIAL", "FAILED"] as const)(`${type} persists %s and clears the live outcome`, async outcome => {
      run.type = type;
      (type === "RECON" ? mocks.recon : mocks.hunt).mockResolvedValue(outcome === "SUCCESS" ? { outcome } : { outcome, reason: "analysis incomplete" });
      await processor.process(job(type));
      expect(mocks.claim.mock.calls[0][0].data).toMatchObject({ status: "RUNNING", outcome: null, error: null });
      expect(run).toMatchObject({ status: outcome === "FAILED" ? "FAILED" : "COMPLETED", outcome, error: outcome === "SUCCESS" ? null : "analysis incomplete", finishedAt: expect.any(Date) });
      expect(attempts[0].state).toBe(outcome === "FAILED" ? "FAILED" : "COMPLETED");
    });
    it(`${type} blocking error fails the scan and BullMQ handler`, async () => {
      run.type = type; (type === "RECON" ? mocks.recon : mocks.hunt).mockRejectedValue(new Error("invalid context"));
      await expect(processor.process(job(type))).rejects.toThrow("invalid context");
      expect(run).toMatchObject({ status: "FAILED", outcome: "FAILED" }); expect(attempts[0].state).toBe("FAILED");
    });
  }
  it("two worker identities cannot execute the same scan concurrently", async () => {
    mocks.recon.mockResolvedValue({ outcome: "SUCCESS" });
    const other = createScanProcessor("worker-B");
    await Promise.all([processor.process(job("RECON")), other.process(job("RECON"))]);
    expect(attempts).toHaveLength(1); expect(mocks.recon).toHaveBeenCalledOnce();
    expect(attempts[0].workerId).toBe("worker-A");
  });
  it("revoked scope prevents scan work after winning the execution claim", async () => {
    run.target = { ...target, scope: { status: "REVOKED" } };
    await expect(processor.process(job("RECON"))).rejects.toThrow("APPROVED");
    expect(run).toMatchObject({ status: "FAILED", outcome: "FAILED" }); expect(mocks.recon).not.toHaveBeenCalled();
    expect(mocks.execution).toHaveBeenCalledWith("target");
  });
  it("removed target execution cannot start network work", async () => {
    mocks.execution.mockRejectedValue(new Error("Host has been removed from Scope"));
    await expect(processor.process(job("RECON"))).rejects.toThrow("removed");
    expect(mocks.recon).not.toHaveBeenCalled(); expect(run).toMatchObject({ status: "FAILED", outcome: "FAILED" });
  });
  it.each(["RUNNING", "COMPLETED", "FAILED", "CANCELLED"])("does not replay historical %s jobs or invent attempts", async status => {
    run.status = status; await processor.process(job("RECON"));
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.execution).not.toHaveBeenCalled(); expect(attempts).toHaveLength(0);
  });
});
describe("replay, heartbeat and cancellation", () => {
  it("fresh attempt refuses replay and remains owned by its live worker", async () => {
    await previous(false); await processor.process(job("RECON"));
    expect(run.status).toBe("RUNNING"); expect(attempts[0].state).toBe("RUNNING"); expect(mocks.recon).not.toHaveBeenCalled();
  });
  it.each([false, true])("stale replay interrupts without traffic; useful work=%s", async useful => {
    await previous(true, useful); await processor.process(job("RECON"));
    expect(attempts[0].state).toBe("INTERRUPTED"); expect(run).toMatchObject({ status: "FAILED", outcome: useful ? "PARTIAL" : "FAILED", finishedAt: expect.any(Date) });
    expect(mocks.recon).not.toHaveBeenCalled(); expect(run.reconCorpus).toEqual({ observed: true });
  });
  it("startup reconciliation expires stale heartbeats and preserves recent ones", async () => {
    await previous(false); expect(await reconcileScanExecutions()).toBe(0);
    attempts[0].heartbeatAt = new Date(Date.now() - HEARTBEAT_STALE_MS - 1);
    expect(await reconcileScanExecutions()).toBe(1); expect(run.status).toBe("FAILED"); expect(attempts[0].state).toBe("INTERRUPTED");
  });
  it("cancellation before start prevents the scanner and creates no attempt", async () => {
    run.cancelRequestedAt = new Date(); await processor.process(job("RECON"));
    expect(run).toMatchObject({ status: "CANCELLED", outcome: null }); expect(attempts).toHaveLength(0); expect(mocks.recon).not.toHaveBeenCalled();
  });
  it("durable cancellation reaches the owner; CANCELLED waits for actual cleanup", async () => {
    vi.useFakeTimers(); let release!: () => void;
    const cleaned = new Promise<void>(resolve => { release = resolve; }); let signal!: AbortSignal;
    mocks.recon.mockImplementation(async () => { const control = currentScanControl()!; signal = control.signal; control.track(() => cleaned); return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); });
    const work = processor.process(job("RECON")); await vi.advanceTimersByTimeAsync(0);
    run.cancelRequestedAt = new Date(); await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(signal.aborted).toBe(true); expect(run.status).toBe("RUNNING");
    release(); await work;
    expect(run).toMatchObject({ status: "CANCELLED", outcome: null }); expect(attempts[0].state).toBe("CANCELLED");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("worker shutdown aborts resources, marks interruption and rejects new work", async () => {
    let stopped = false;
    mocks.recon.mockImplementation(async () => { currentScanControl()!.track(async () => { stopped = true; }); return new Promise(() => {}); });
    const work = processor.process(job("RECON")); await vi.waitFor(() => expect(mocks.recon).toHaveBeenCalledOnce());
    await processor.shutdown(); await work;
    expect(stopped).toBe(true); expect(run.status).toBe("FAILED"); expect(attempts[0].state).toBe("INTERRUPTED");
    await processor.process(job("RECON")); expect(mocks.recon).toHaveBeenCalledOnce();
  });
  it("a lost DB heartbeat aborts the scan instead of continuing traffic", async () => {
    vi.useFakeTimers();
    mocks.recon.mockImplementation(async () => {
      const signal = currentScanControl()!.signal;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const work = processor.process(job("RECON")); await vi.advanceTimersByTimeAsync(0);
    mocks.attemptUpdate.mockRejectedValueOnce(new Error("database unavailable"));
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS); await work;
    expect(attempts[0]).toMatchObject({ state: "INTERRUPTED", reason: "HEARTBEAT_LOST" });
    expect(run).toMatchObject({ status: "FAILED", outcome: "FAILED" });
  });
  it("cannot claim CANCELLED if resource cleanup fails", async () => {
    vi.useFakeTimers();
    mocks.recon.mockImplementation(async () => {
      const control = currentScanControl()!;
      control.track(async () => { throw new Error("cleanup failed"); });
      return new Promise((_, reject) => control.signal.addEventListener("abort", () => reject(control.signal.reason), { once: true }));
    });
    const work = processor.process(job("RECON")); await vi.advanceTimersByTimeAsync(0);
    run.cancelRequestedAt = new Date(); await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS); await work;
    expect(run.status).toBe("FAILED"); expect(attempts[0]).toMatchObject({ state: "INTERRUPTED", reason: "CLEANUP_UNCONFIRMED" });
  });

  it("shutdown grace expiry forces cleanup and durably fences a stuck handler", async () => {
    vi.useFakeTimers();
    const force = vi.fn<(force: boolean) => Promise<void>>(async () => new Promise<void>(() => {}));
    mocks.recon.mockImplementation(async () => { currentScanControl()!.track(force); return new Promise(() => {}); });
    const work = processor.process(job("RECON")); await vi.advanceTimersByTimeAsync(0);
    const shutdown = processor.shutdown(10); await vi.advanceTimersByTimeAsync(1500); await shutdown;
    expect(force.mock.calls.some(call => call[0] === true)).toBe(true);
    expect(attempts[0]).toMatchObject({ state: "INTERRUPTED", reason: "WORKER_SHUTDOWN_GRACE_EXPIRED" });
    expect(run.status).toBe("FAILED");
    await vi.advanceTimersByTimeAsync(6000); await work;
    expect(attempts[0].reason).toBe("WORKER_SHUTDOWN_GRACE_EXPIRED");
  });
  it("late success cannot overwrite an interruption committed by another worker", async () => {
    let finish!: (value: { outcome: "SUCCESS" }) => void;
    mocks.recon.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const work = processor.process(job("RECON")); await vi.waitFor(() => expect(mocks.recon).toHaveBeenCalledOnce());
    attempts[0].heartbeatAt = new Date(0); await reconcileScanExecutions();
    finish({ outcome: "SUCCESS" }); await work;
    expect(run).toMatchObject({ status: "FAILED", outcome: "FAILED" }); expect(attempts[0].state).toBe("INTERRUPTED");
  });

  it("shutdown defers a concurrently acquired but never-started job instead of completing it", async () => {
    processor.stopAccepting(); const waiting = vi.fn(async () => 0);
    const acquired = { ...job("RECON"), token: "lock-token", moveToWait: waiting } as unknown as Job<ScanJobData>;
    await expect(processor.process(acquired)).rejects.toMatchObject({ name: "WaitingError" });
    expect(waiting).toHaveBeenCalledWith("lock-token"); expect(run.status).toBe("QUEUED"); expect(attempts).toHaveLength(0);
    expect(mocks.recon).not.toHaveBeenCalled();
    mocks.recon.mockResolvedValue({ outcome: "SUCCESS" });
    await createScanProcessor("replacement-worker").process(acquired);
    expect(run.status).toBe("COMPLETED"); expect(mocks.recon).toHaveBeenCalledOnce();
  });

  it("cannot falsely acknowledge an unstarted shutdown job when PostgreSQL is unavailable", async () => {
    processor.stopAccepting(); mocks.find.mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(processor.process(job("RECON"))).rejects.toMatchObject({ name: "WaitingError" });
    expect(run.status).toBe("QUEUED"); expect(attempts).toHaveLength(0); expect(mocks.recon).not.toHaveBeenCalled();
  });

});
