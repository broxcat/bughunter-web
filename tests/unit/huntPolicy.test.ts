import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHuntPolicySnapshot } from "@/lib/hunt/policy";
import { withTargetExecution } from "@/server/execution";
const calls = vi.hoisted(() => ({
  runAuthBypass: vi.fn(async () => {}),
  runIdor: vi.fn(async () => {}),
  runXss: vi.fn(async () => {}),
  runSsrf: vi.fn(async () => {}),
  runBola: vi.fn(async () => {}),
  runCsrf: vi.fn(async () => {}),
  runSqli: vi.fn(async () => {}),
  runCommandInjection: vi.fn(async () => {}),
  runSsti: vi.fn(async () => {}),
  runCors: vi.fn(async () => {}),
  runJwt: vi.fn(async () => {}),
  runOauth: vi.fn(async () => {}),
  runXxe: vi.fn(async () => {}),
  runLfi: vi.fn(async () => {}),
  runDeserialization: vi.fn(async () => {}),
  runBusinessLogicRace: vi.fn(async () => {}),
  runBusinessLogicTamper: vi.fn(async () => {}),
  runBusinessLogicWorkflow: vi.fn(async () => {}),
  disclosure: vi.fn(async () => {}),
  command: vi.fn(async () => ({ code: 0, timedOut: false })),
}));
vi.mock("@/server/scanners/auth-bypass", () => ({ runAuthBypass: calls.runAuthBypass }));
vi.mock("@/server/scanners/idor", () => ({ runIdor: calls.runIdor }));
vi.mock("@/server/scanners/xss", () => ({ runXss: calls.runXss }));
vi.mock("@/server/scanners/ssrf", () => ({ runSsrf: calls.runSsrf }));
vi.mock("@/server/scanners/bola", () => ({ runBola: calls.runBola }));
vi.mock("@/server/scanners/csrf", () => ({ runCsrf: calls.runCsrf }));
vi.mock("@/server/scanners/sqli", () => ({ runSqli: calls.runSqli }));
vi.mock("@/server/scanners/commandInjection", () => ({ runCommandInjection: calls.runCommandInjection }));
vi.mock("@/server/scanners/ssti", () => ({ runSsti: calls.runSsti }));
vi.mock("@/server/scanners/cors", () => ({ runCors: calls.runCors }));
vi.mock("@/server/scanners/jwt", () => ({ runJwt: calls.runJwt }));
vi.mock("@/server/scanners/oauth", () => ({ runOauth: calls.runOauth }));
vi.mock("@/server/scanners/xxe", () => ({ runXxe: calls.runXxe }));
vi.mock("@/server/scanners/lfi", () => ({ runLfi: calls.runLfi }));
vi.mock("@/server/scanners/deserialization", () => ({ runDeserialization: calls.runDeserialization }));
vi.mock("@/server/scanners/businessLogicRace", () => ({ runBusinessLogicRace: calls.runBusinessLogicRace }));
vi.mock("@/server/scanners/businessLogicTamper", () => ({ runBusinessLogicTamper: calls.runBusinessLogicTamper }));
vi.mock("@/server/scanners/businessLogicWorkflow", () => ({ runBusinessLogicWorkflow: calls.runBusinessLogicWorkflow }));
vi.mock("@/server/hunt/runtime", () => ({ withHuntSession: vi.fn(async (_ctx, policy, work) => work({ families: createHuntPolicySnapshot(policy).families.map(f => ({ ...f, safeSubset: f.selected })) })), runFamilyTechniques: vi.fn(async (_ctx, family) => { if (family === "information-disclosure") await calls.disclosure(); }) }));
vi.mock("@/server/hunt/readiness", () => ({ loadHuntReadiness: vi.fn(async (_target, policy) => ({ families: createHuntPolicySnapshot(policy).families.map(f => ({ ...f, safeSubset: f.selected, state: f.selected ? "READY" : "NOT_SELECTED", prerequisites: [], riskClass: "SAFE_ACTIVE" })) })) }));
vi.mock("@/server/hunt/snapshot", () => ({ startHuntSnapshot: vi.fn(async (_id, execution) => createHuntPolicySnapshot(execution)) }));
vi.mock("@/server/scanners/runCommand", () => ({ runCommand: calls.command }));
vi.mock("@/server/scanners/context", () => ({ loadScanContext: vi.fn(async () => ({ scanRunId: "r", targetId: "t", userId: "u", host: "api.example.com", baseUrl: "https://api.example.com" })), logLine: vi.fn(async () => {}) }));
import { runHunt } from "@/server/scanners/hunt";
beforeEach(() => vi.clearAllMocks());
const run = (qualifying: string[], nonQualifying: string[]) => withTargetExecution({ targetId: "t", host: "api.example.com", requiredUserAgent: "Program/1", qualifying, nonQualifying }, () => runHunt("api.example.com", "r"));
describe("Hunt program policy", () => {
  it("empty optional lists allow the supported scanners", async () => {
    await run([], []);
    expect(calls.runXss).toHaveBeenCalledOnce();
    expect(calls.runSqli).toHaveBeenCalledOnce();
    expect(calls.disclosure).toHaveBeenCalledOnce();
    expect(calls.command).not.toHaveBeenCalled();
  });
  it("explicit exclusion wins and excludes shared family aliases", async () => {
    await run(["XSS", "IDOR", "ACCESS_CONTROL"], ["XSS", "ACCESS_CONTROL"]);
    expect(calls.runXss).not.toHaveBeenCalled();
    expect(calls.runIdor).not.toHaveBeenCalled();
    expect(calls.runBola).not.toHaveBeenCalled();
    expect(calls.command).not.toHaveBeenCalled();
  });
  it("a qualifying unsupported family never enables an arbitrary scanner or nuclei sweep", async () => {
    await run(["RFI", "OPEN_REDIRECT"], []);
    for (const handler of Object.values(calls)) expect(handler).not.toHaveBeenCalled();
  });
});
