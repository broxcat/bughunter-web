import { ScanControl, withScanControl } from "@/server/scanControl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeCorpus } from "@/server/hunt/corpus";
import { EMPTY_READINESS_FACTS, resolveHuntReadiness } from "@/lib/hunt/readiness";
import { createHuntPolicySnapshot } from "@/lib/hunt/policy";
import type { HuntReport } from "@/lib/hunt/report";
const mocks = vi.hoisted(() => ({ corpus: vi.fn(), execute: vi.fn(), probe: vi.fn(), persist: vi.fn(), log: vi.fn(), sessions: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { scanRun: { updateMany: mocks.persist } } }));
vi.mock("@/server/scanners/context", () => ({ logLine: mocks.log }));
vi.mock("@/server/scanners/http", () => ({ probe: mocks.probe }));
vi.mock("@/server/credentials", () => ({ loadTargetCredentials: vi.fn(async () => []) }));
vi.mock("@/server/credentials/connection", () => ({ revalidateTargetSessions: mocks.sessions }));
vi.mock("@/server/hunt/corpus", async importOriginal => ({ ...await importOriginal<object>(), collectHuntCorpus: mocks.corpus }));
vi.mock("@/server/hunt/techniques", () => ({ executeHuntTechnique: mocks.execute }));
vi.mock("@/server/hunt/readiness", () => ({ loadHuntReadiness: async () => ({ families: resolveHuntReadiness({ qualifying: ["SSTI"], nonQualifying: [] }, EMPTY_READINESS_FACTS), facts: EMPTY_READINESS_FACTS }) }));
import { withTargetExecution } from "@/server/execution";
import { withHuntSession, runFamilyTechniques, type TechniqueContext } from "@/server/hunt/runtime";
import { HuntLimitError } from "@/server/hunt/budget";
const ctx = { scanRunId: "run", targetId: "target", userId: "owner", host: "example.test", baseUrl: "https://example.test" };
function run(work = () => runFamilyTechniques(ctx, "ssti")) {
  return withTargetExecution({ targetId: ctx.targetId, host: ctx.host, requiredUserAgent: "Test/1", qualifying: ["SSTI"], nonQualifying: [] }, () => withHuntSession(ctx, createHuntPolicySnapshot({ qualifying: ["SSTI"], nonQualifying: [] }), work));
}
function lastReport(): HuntReport { return mocks.persist.mock.calls.map(c => c[0].data.huntReport).filter(Boolean).at(-1); }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.corpus.mockResolvedValue(analyzeCorpus({ html: "", urls: [ctx.baseUrl + "/search?q=1"], authenticated: false, execution: { successfulRequests: 1, failedRequests: 0, issues: [] } }, ctx.baseUrl));
  mocks.execute.mockResolvedValue([]);
});
describe("Hunt runtime returns its actual execution result", () => {
  it("normal completion without findings succeeds", async () => {
    expect(await run()).toEqual({ outcome: "SUCCESS" });
    expect(lastReport().status).toBe("COMPLETED");
  });
  it.each([new Error("secret must not be logged"), new HuntLimitError("TECHNIQUE_REQUEST_LIMIT")])("continues after a technique error or budget limit", async error => {
    mocks.execute.mockRejectedValueOnce(error);
    expect((await run()).outcome).toBe("PARTIAL");
    expect(mocks.execute.mock.calls.length).toBeGreaterThan(1);
    expect(lastReport().techniques.some(t => t.state === "COMPLETED")).toBe(true);
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("secret must not be logged");
    expect(mocks.log).toHaveBeenCalledWith("run", expect.stringContaining("result: PARTIAL"), "STDERR");
  });
  it("global interruption after discovery is partial", async () => {
    expect((await run(async () => { throw new HuntLimitError("HUNT_TIMEOUT"); })).outcome).toBe("PARTIAL");
    expect(lastReport().status).toBe("LIMIT_REACHED");
  });
  it("required transport failures reduce coverage even when techniques return observations", async () => {
    mocks.probe.mockResolvedValue({ error: "transport secret", status: 0, body: "" });
    mocks.execute.mockImplementation(async (_technique: unknown, c: TechniqueContext) => { await c.request(ctx.baseUrl); return []; });
    expect((await run()).outcome).toBe("PARTIAL");
    expect(lastReport().techniques.filter(t => t.state === "ERROR").length).toBeGreaterThan(0);
    expect(JSON.stringify(lastReport())).not.toContain("transport secret");
  });
  it("unavailable browser controls reduce coverage", async () => {
    mocks.execute.mockImplementationOnce(async (technique: { id: string }, c: TechniqueContext) => { c.cache.set(`execution-incomplete:${technique.id}`, true); return []; });
    expect((await run()).outcome).toBe("PARTIAL");
  });
  it("intentional safety skips do not reduce coverage", async () => {
    mocks.execute.mockRejectedValue(new HuntLimitError("STATE_CHANGING_REQUEST_UNSUPPORTED"));
    expect((await run()).outcome).toBe("SUCCESS");
  });
  it("a revoked scope swallowed by discovery remains a blocking failure", async () => {
    mocks.corpus.mockResolvedValue(analyzeCorpus({ html: "", urls: [], authenticated: false, execution: { successfulRequests: 1, failedRequests: 1, issues: ["SCOPE_REVOKED"] } }, ctx.baseUrl));
    await expect(run()).rejects.toThrow("SCOPE_REVOKED");
    expect(lastReport().status).toBe("FAILED"); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("blocking setup failure is recorded and propagated", async () => {
    mocks.sessions.mockRejectedValue(new Error("invalid target context"));
    await expect(run()).rejects.toThrow("invalid target context");
    expect(lastReport().status).toBe("FAILED"); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("discovery failed before any useful work gives a failed outcome", async () => {
    mocks.corpus.mockResolvedValue(analyzeCorpus({ html: "", urls: [], authenticated: false, execution: { successfulRequests: 0, failedRequests: 1, issues: ["DISCOVERY_TRANSPORT_ERROR"] } }, ctx.baseUrl));
    expect((await run()).outcome).toBe("FAILED");
  });
  it("user cancellation stops Hunt without reporting SUCCESS or generic FAILED", async () => {
    const control = new ScanControl({ scanRunId: "run", attemptId: "attempt", workerId: "worker" }, async () => {});
    mocks.execute.mockImplementationOnce(async () => { control.abort("USER_CANCELLED"); control.assertActive(); });
    await expect(withScanControl(control, () => run())).rejects.toMatchObject({ reason: "USER_CANCELLED" });
    expect(lastReport().status).toBe("CANCELLED"); expect(mocks.execute).toHaveBeenCalledOnce();
  });

});
