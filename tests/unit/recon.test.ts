import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ command: vi.fn(), dns: vi.fn(), discovery: vi.fn(), context: vi.fn(), credentials: vi.fn(), log: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { scanRun: { updateMany: mocks.update } } }));
vi.mock("@/server/execution", () => ({ currentTargetExecution: () => ({ targetId: "target", host: "example.test", requiredUserAgent: "Test/1" }) }));
vi.mock("@/server/scanners/context", () => ({ loadScanContext: mocks.context, logLine: mocks.log }));
vi.mock("@/server/scanners/discovery", () => ({ discoverCorpus: mocks.discovery, clearDiscoveryCorpus: vi.fn() }));
vi.mock("@/server/scanners/runCommand", () => ({ runCommand: mocks.command }));
vi.mock("@/server/credentials", () => ({ loadTargetCredentials: mocks.credentials, credentialHeaders: () => ({}) }));
vi.mock("node:dns/promises", () => ({ Resolver: class { resolveAny = mocks.dns; cancel() {} } }));
import { runRecon } from "@/server/scanners/recon";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ targetId: "target", scanRunId: "run", host: "example.test", baseUrl: "https://example.test" });
  mocks.command.mockResolvedValue({ code: 0, timedOut: false });
  mocks.dns.mockResolvedValue([]);
  mocks.credentials.mockResolvedValue([]);
  mocks.discovery.mockResolvedValue({ html: "", urls: [], authenticated: false, execution: { successfulRequests: 1, failedRequests: 0, issues: [] } });
});
describe("best-effort Recon", () => {
  it("successful host commands with no output and program-level enumeration are successful", async () => {
    expect(await runRecon("example.test", "run")).toEqual({ outcome: "SUCCESS" });
    expect(mocks.command.mock.calls.map(c => c[0])).toEqual(["httpx", "nmap", "katana"]);
    expect(mocks.log.mock.calls.some(c => c[1].includes("subfinder: performed in program Recon"))).toBe(true);
  });
  it.each([
    { code: 2, timedOut: false },
    { code: null, timedOut: true },
    { code: null, timedOut: false },
    { code: null, timedOut: false, spawnFailed: true },
  ])("continues after httpx %j and returns partial", async result => {
    mocks.command.mockResolvedValueOnce(result);
    expect(await runRecon("example.test", "run")).toMatchObject({ outcome: "PARTIAL", reason: expect.stringContaining("httpx:") });
    expect(mocks.command).toHaveBeenCalledTimes(3);
  });
  it("does not hide synchronous command execution failures", async () => {
    mocks.command.mockRejectedValueOnce(new Error("do not expose secret"));
    expect(await runRecon("example.test", "run")).toMatchObject({ outcome: "PARTIAL" });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("do not expose secret");
    expect(mocks.command).toHaveBeenCalledTimes(3);
  });
  it("fails if every attempted step fails", async () => {
    mocks.discovery.mockResolvedValue({ html: "", urls: [], authenticated: false, execution: { successfulRequests: 0, failedRequests: 1, issues: ["DISCOVERY_TRANSPORT_ERROR"] } });
    mocks.dns.mockRejectedValue(new Error("resolver unavailable"));
    mocks.command.mockResolvedValue({ code: null, timedOut: false });
    expect((await runRecon("example.test", "run")).outcome).toBe("FAILED");
  });
  it("no DNS records is not a failure; DNS errors reduce coverage", async () => {
    mocks.dns.mockRejectedValueOnce(Object.assign(new Error(), { code: "ENODATA" }));
    expect((await runRecon("example.test", "run")).outcome).toBe("SUCCESS");
    mocks.dns.mockRejectedValueOnce(Object.assign(new Error(), { code: "ETIMEOUT" }));
    expect((await runRecon("example.test", "run")).outcome).toBe("PARTIAL");
  });
  it("invalid context is blocking and no commands run", async () => {
    mocks.context.mockResolvedValue(null);
    await expect(runRecon("example.test", "run")).rejects.toThrow("Missing authorized scan context");
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it("authenticated discovery failure reduces coverage", async () => {
    mocks.credentials.mockRejectedValue(new Error("secret"));
    expect((await runRecon("example.test", "run")).outcome).toBe("PARTIAL");
  });
});
