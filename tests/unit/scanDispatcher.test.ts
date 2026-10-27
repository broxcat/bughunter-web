import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ pending: vi.fn(), publish: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { scanJobOutbox: { findMany: mocks.pending } } }));
vi.mock("@/server/queue/scanJobPublisher", () => ({ publishScanJob: mocks.publish }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn } }));
import { dispatchPendingScanJobs, startScanDispatcher, DISPATCH_BATCH_SIZE } from "@/server/queue/scanDispatcher";
beforeEach(() => { vi.resetAllMocks(); mocks.pending.mockResolvedValue([]); mocks.publish.mockResolvedValue({ dispatch: "PUBLISHED" }); });
afterEach(() => vi.useRealTimers());
describe("worker dispatch loop", () => {
  it("reads only a bounded batch of due PENDING entries and publishes via the common path", async () => {
    mocks.pending.mockResolvedValue([{ scanRunId: "run", createdAt: new Date() }]);
    await dispatchPendingScanJobs();
    expect(mocks.pending.mock.calls[0][0]).toMatchObject({ take: DISPATCH_BATCH_SIZE, where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: expect.any(Date) } }] } });
    expect(mocks.publish).toHaveBeenCalledWith("run", "dispatcher");
  });
  it("starts immediately, survives errors, retries on a timer and stops cleanly", async () => {
    vi.useFakeTimers(); mocks.pending.mockRejectedValueOnce(new Error("private DB URL"));
    const loop = startScanDispatcher(100);
    await vi.advanceTimersByTimeAsync(101);
    expect(mocks.pending).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("private DB URL");
    await loop.close(); await vi.advanceTimersByTimeAsync(500);
    expect(mocks.pending).toHaveBeenCalledTimes(2);
  });
  it("does not overlap batches and shutdown waits for the current delivery", async () => {
    vi.useFakeTimers(); let release!: () => void;
    mocks.pending.mockResolvedValue([{ scanRunId: "run", createdAt: new Date() }]);
    mocks.publish.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    const loop = startScanDispatcher(100); await vi.advanceTimersByTimeAsync(500);
    expect(mocks.pending).toHaveBeenCalledOnce();
    let closed = false; const close = loop.close().then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(100); expect(closed).toBe(false);
    release(); await close; await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.pending).toHaveBeenCalledOnce();
  });
});
