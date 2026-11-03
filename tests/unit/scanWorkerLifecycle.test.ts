import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ construct: vi.fn(), on: vi.fn(), pause: vi.fn(async () => {}), run: vi.fn(async () => {}), workerClose: vi.fn(async () => {}), start: vi.fn(), dispatcherClose: vi.fn(async () => {}), maintain: vi.fn(async () => {}), maintenanceClose: vi.fn(async () => {}), stop: vi.fn(), shutdown: vi.fn(async () => {}), redis: { options: { maxRetriesPerRequest: null }, disconnect: vi.fn() }, process: vi.fn(), interrupt: vi.fn() }));
vi.mock("bullmq", () => ({ Worker: class { constructor(...args: unknown[]) { mocks.construct(...args); } on = mocks.on; close = mocks.workerClose; pause = mocks.pause; run = mocks.run; } }));
vi.mock("@/server/queue/connection", () => ({ redis: mocks.redis }));
vi.mock("@/server/queue/processScan", () => ({ createScanProcessor: () => ({ process: mocks.process, stopAccepting: mocks.stop, shutdown: mocks.shutdown, interrupt: mocks.interrupt }) }));
vi.mock("@/server/queue/executionAttempts", () => ({ workerIdentity: () => "test-worker" }));
vi.mock("@/server/queue/executionMaintenance", () => ({ maintainScanExecutions: mocks.maintain, startExecutionMaintenance: () => ({ close: mocks.maintenanceClose }) }));
vi.mock("@/server/queue/scanDispatcher", () => ({ startScanDispatcher: mocks.start }));
vi.mock("@/server/queue/scanQueue", () => ({ SCAN_QUEUE_NAME: "scans" }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
describe("standalone worker integration", () => {
  it("reconciles before acquisition, runs maintenance and outbox, then aborts on SIGTERM", async () => {
    mocks.start.mockReturnValue({ close: mocks.dispatcherClose });
    const originalTerm = process.listeners("SIGTERM"), originalInt = process.listeners("SIGINT");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    try {
      const { ready } = await import("@/server/queue/worker"); await ready;
      expect(mocks.maintain).toHaveBeenCalledOnce(); expect(mocks.start).toHaveBeenCalledOnce();
      expect(mocks.construct.mock.calls[0][2]).toEqual({ connection: mocks.redis, concurrency: 2, autorun: false, maxStalledCount: 1 });
      expect(mocks.maintain.mock.invocationCallOrder[0]).toBeLessThan(mocks.run.mock.invocationCallOrder[0]);
      const lockLost = mocks.on.mock.calls.find(call => call[0] === "lockRenewalFailed")![1]; lockLost(["scan-id"]);
      expect(mocks.interrupt).toHaveBeenCalledWith("scan-id", "WORKER_LOCK_LOST");
      const shutdown = process.listeners("SIGTERM").find(listener => !originalTerm.includes(listener))!;
      shutdown("SIGTERM"); await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
      expect(mocks.stop).toHaveBeenCalledOnce(); expect(mocks.pause).toHaveBeenCalledWith(true);
      expect(mocks.shutdown).toHaveBeenCalledOnce(); expect(mocks.workerClose).toHaveBeenCalledWith(true);
      expect(mocks.dispatcherClose).toHaveBeenCalledOnce(); expect(mocks.maintenanceClose).toHaveBeenCalledOnce(); expect(mocks.redis.disconnect).toHaveBeenCalledOnce();
    } finally {
      for (const listener of process.listeners("SIGTERM")) if (!originalTerm.includes(listener)) process.removeListener("SIGTERM", listener);
      for (const listener of process.listeners("SIGINT")) if (!originalInt.includes(listener)) process.removeListener("SIGINT", listener);
      exit.mockRestore();
    }
  });
});
