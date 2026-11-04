import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ probe: vi.fn(), credentials: vi.fn() }));
vi.mock("@/server/scanners/http", () => ({ probe: mocks.probe }));
vi.mock("@/server/credentials", () => ({ loadTargetCredentials: mocks.credentials, credentialHeaders: () => ({}) }));
import { discoverCorpus, clearDiscoveryCorpus } from "@/server/scanners/discovery";
import { withTargetExecution } from "@/server/execution";
const ctx = { scanRunId: "run", targetId: "target", userId: "owner", host: "example.test", baseUrl: "https://example.test" };
const collect = (seeds: string[] = []) => withTargetExecution({ targetId: ctx.targetId, host: ctx.host, requiredUserAgent: "Fixture/1", qualifying: [], nonQualifying: [] }, () => discoverCorpus(ctx, seeds));
beforeEach(() => { vi.resetAllMocks(); clearDiscoveryCorpus(ctx.scanRunId); mocks.credentials.mockResolvedValue([]); });
describe("structured discovery diagnostics", () => {
  it("an empty response is a successful request", async () => {
    mocks.probe.mockResolvedValue({ status: 204, body: "", headers: {} });
    expect((await collect()).execution).toEqual({ successfulRequests: 1, failedRequests: 0, issues: [] });
  });
  it("retains successful discovery when another request fails and never retains the error text", async () => {
    mocks.probe.mockResolvedValueOnce({ status: 200, body: '<a href="/next">next</a>', headers: {} }).mockResolvedValue({ error: "token secret", status: 0 });
    const corpus = await collect();
    expect(corpus.execution).toEqual({ successfulRequests: 1, failedRequests: 1, issues: ["DISCOVERY_TRANSPORT_ERROR"] });
    expect(JSON.stringify(corpus)).not.toContain("token secret");
  });
  it.each(["HUNT_TIMEOUT", "SCOPE_REVOKED", "TOTAL_REQUEST_LIMIT"])("stops on %s and preserves the code", async error => {
    mocks.probe.mockResolvedValue({ error, status: 0 });
    expect((await collect([ctx.baseUrl + "/other"])).execution).toEqual({ successfulRequests: 0, failedRequests: 1, issues: [error] });
    expect(mocks.probe).toHaveBeenCalledOnce();
  });
  it("legacy discovery stays anonymous and never selects an implicit first credential", async () => {
    mocks.credentials.mockRejectedValue(new Error("secret"));
    mocks.probe.mockResolvedValue({ status: 200, body: "", headers: {} });
    const result=await collect();
    expect(result.execution?.issues).toEqual([]);
    expect(result.authenticated).toBe(false);
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.probe.mock.calls.every(call=>!call[1]?.headers)).toBe(true);
  });
});
