import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ construct: vi.fn(), on: vi.fn(), workerClose: vi.fn(async () => {}), start: vi.fn(), dispatcherClose: vi.fn(async () => {}), redis: { options: { maxRetriesPerRequest: null }, disconnect: vi.fn() }, processScan: vi.fn() }));
vi.mock("bullmq", () => ({ Worker: class { constructor(...args: unknown[]) { mocks.construct(...args); } on = mocks.on; close = mocks.workerClose; } }));
vi.mock("@/server/queue/connection", () => ({ redis: mocks.redis }));
vi.mock("@/server/queue/processScan", () => ({ processScan: mocks.processScan }));
vi.mock("@/server/queue/scanDispatcher", () => ({ startScanDispatcher: mocks.start }));
vi.mock("@/server/queue/scanQueue", () => ({ SCAN_QUEUE_NAME: "scans" }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn() }, scanLogger: vi.fn() }));
describe("standalone worker integration", () => {
  it("starts the dispatcher with the persistent worker and closes both on shutdown", async () => {
    mocks.start.mockReturnValue({ close: mocks.dispatcherClose });
    const originalTerm = process.listeners("SIGTERM"); const originalInt = process.listeners("SIGINT");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    try {
      await import("@/server/queue/worker");
      expect(mocks.start).toHaveBeenCalledOnce();
      expect(mocks.construct).toHaveBeenCalledWith("scans", mocks.processScan, { connection: mocks.redis, concurrency: 1 });
      expect(mocks.redis.options.maxRetriesPerRequest).toBeNull();
      const shutdown = process.listeners("SIGTERM").find(listener => !originalTerm.includes(listener))!;
      shutdown("SIGTERM"); await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
      expect(mocks.dispatcherClose).toHaveBeenCalledOnce(); expect(mocks.workerClose).toHaveBeenCalledOnce(); expect(mocks.redis.disconnect).toHaveBeenCalledOnce();
    } finally {
      for (const listener of process.listeners("SIGTERM")) if (!originalTerm.includes(listener)) process.removeListener("SIGTERM", listener);
      for (const listener of process.listeners("SIGINT")) if (!originalInt.includes(listener)) process.removeListener("SIGINT", listener);
      exit.mockRestore();
    }
  });
});
