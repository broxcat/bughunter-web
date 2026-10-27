import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ tx: vi.fn(), locked: vi.fn(), find: vi.fn(), run: vi.fn(), updateIntent: vi.fn(), updateRun: vi.fn(), deliver: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.tx } }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn } }));
vi.mock("@/server/queue/scanQueue", () => ({ deliverScanJob: mocks.deliver }));
import { publishScanJob, publicationBackoffMs } from "@/server/queue/scanJobPublisher";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tx.mockImplementation(work => work({ $queryRaw: mocks.locked, scanJobOutbox: { findUnique: mocks.find, findUniqueOrThrow: mocks.run, update: mocks.updateIntent }, scanRun: { update: mocks.updateRun } }));
  mocks.locked.mockResolvedValue([{ id: "intent" }]);
  mocks.run.mockResolvedValue({ id: "intent", attempts: 0, scanRun: { id: "run", targetId: "target", type: "RECON", status: "QUEUED" } });
});
describe("outbox publication policy", () => {
  it.each([[1, 1000], [2, 2000], [5, 16000], [10, 300000], [1000, 300000]])("attempt %i backoff is bounded at %i ms", (attempts, delay) => {
    expect(publicationBackoffMs(attempts)).toBe(delay);
  });
  it("records errors as fixed codes and retries publication without failing scan execution", async () => {
    mocks.deliver.mockRejectedValue(new Error("redis://user:private-password@private-host"));
    expect(await publishScanJob("run")).toEqual({ dispatch: "PENDING" });
    expect(mocks.updateIntent).toHaveBeenCalledWith({ where: { id: "intent" }, data: { attempts: 1, lastError: "QUEUE_DELIVERY_UNCONFIRMED", nextAttemptAt: expect.any(Date) } });
    expect(mocks.updateRun).not.toHaveBeenCalled();
    expect(JSON.stringify([mocks.warn.mock.calls, mocks.updateIntent.mock.calls])).not.toContain("private-password");
  });
  it("durably retryable after repeated failures and clearly observable", async () => {
    mocks.run.mockResolvedValue({ id: "intent", attempts: 10, scanRun: { id: "run", targetId: "target", type: "RECON", status: "QUEUED" } });
    mocks.deliver.mockRejectedValue(new Error("unavailable"));
    expect((await publishScanJob("run", "dispatcher")).dispatch).toBe("PENDING");
    expect(mocks.warn.mock.calls[0][0]).toMatchObject({ scanRunId: "run", targetId: "target", attempts: 11, source: "dispatcher" });
    expect(mocks.warn.mock.calls[0][1]).toContain("retry remains scheduled");
  });
  it("DB failure after acceptance defers reconciliation instead of losing intent", async () => {
    mocks.tx.mockRejectedValue(new Error("database connection secret"));
    expect((await publishScanJob("run")).dispatch).toBe("PENDING");
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("connection secret");
  });
});
