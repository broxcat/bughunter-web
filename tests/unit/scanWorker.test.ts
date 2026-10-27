import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { ScanJobData } from "@/server/queue/scanQueue";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), execution: vi.fn(), recon: vi.fn(), hunt: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { scanRun: { findUnique: mocks.find, update: mocks.update } } }));
vi.mock("@/server/execution", () => ({ loadTargetExecution: mocks.execution, withTargetExecution: (_ctx: unknown, work: () => unknown) => work() }));
vi.mock("@/server/scanners/recon", () => ({ runRecon: mocks.recon }));
vi.mock("@/server/scanners/hunt", () => ({ runHunt: mocks.hunt }));
vi.mock("@/server/scanners/context", () => ({ logLine: mocks.log }));
import { processScan } from "@/server/queue/processScan";
const target = { id: "target", host: "example.test", scope: { status: "APPROVED" } };
const job = (type: ScanJobData["type"]) => ({ data: { scanRunId: "run", targetId: "target", type } }) as Job<ScanJobData>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.execution.mockResolvedValue({ targetId: "target", requiredUserAgent: "Test/1" });
});
describe("worker execution outcome persistence", () => {
  it.each(["QUEUED", "RUNNING"])("rejects legacy %s VALIDATE before execution", async status => {
    mocks.find.mockResolvedValue({ status, type: "VALIDATE", target });
    await processScan(job("VALIDATE"));
    expect(mocks.update).toHaveBeenLastCalledWith({ where: { id: "run" }, data: { status: "FAILED", outcome: "UNSUPPORTED", error: expect.stringContaining("not implemented"), finishedAt: expect.any(Date) } });
    expect(mocks.log).toHaveBeenCalledWith("run", expect.stringContaining("UNSUPPORTED"), "STDERR");
    expect(mocks.execution).not.toHaveBeenCalled(); expect(mocks.recon).not.toHaveBeenCalled(); expect(mocks.hunt).not.toHaveBeenCalled();
  });
  for (const type of ["RECON", "HUNT"] as const) {
    it.each(["SUCCESS", "PARTIAL", "FAILED"] as const)(`${type} persists %s and clears the live outcome`, async outcome => {
      mocks.find.mockResolvedValue({ status: "QUEUED", type, target });
      const result = outcome === "SUCCESS" ? { outcome } : { outcome, reason: "analysis incomplete" };
      (type === "RECON" ? mocks.recon : mocks.hunt).mockResolvedValue(result);
      await processScan(job(type));
      expect(mocks.update.mock.calls[0][0].data).toMatchObject({ status: "RUNNING", outcome: null, error: null });
      expect(mocks.update.mock.calls.at(-1)![0].data).toEqual({ status: outcome === "FAILED" ? "FAILED" : "COMPLETED", outcome, error: outcome === "SUCCESS" ? null : "analysis incomplete", finishedAt: expect.any(Date) });
    });
    it(`${type} blocking error fails the scan and the BullMQ job`, async () => {
      mocks.find.mockResolvedValue({ status: "QUEUED", type, target });
      (type === "RECON" ? mocks.recon : mocks.hunt).mockRejectedValue(new Error("invalid context"));
      await expect(processScan(job(type))).rejects.toThrow("invalid context");
      expect(mocks.update.mock.calls.at(-1)![0].data).toMatchObject({ status: "FAILED", outcome: "FAILED" });
    });
  }
  it("revoked scope prevents all scan work", async () => {
    mocks.find.mockResolvedValue({ status: "QUEUED", type: "HUNT", target: { ...target, scope: { status: "REVOKED" } } });
    await processScan(job("HUNT"));
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ status: "FAILED", outcome: "FAILED" });
    expect(mocks.hunt).not.toHaveBeenCalled(); expect(mocks.execution).not.toHaveBeenCalled();
  });
  it("removed or invalid target execution cannot start", async () => {
    mocks.find.mockResolvedValue({ status: "QUEUED", type: "RECON", target });
    mocks.execution.mockRejectedValue(new Error("Host has been removed from Scope"));
    await expect(processScan(job("RECON"))).rejects.toThrow("removed");
    expect(mocks.recon).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls.at(-1)![0].data).toMatchObject({ status: "FAILED", outcome: "FAILED" });
  });
  it.each(["RUNNING", "COMPLETED", "FAILED", "CANCELLED"])("does not replay %s jobs or rewrite historical outcomes", async status => {
    mocks.find.mockResolvedValue({ status, type: "RECON", outcome: null, target });
    await processScan(job("RECON"));
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.execution).not.toHaveBeenCalled();
  });
});
