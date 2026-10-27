import { describe, expect, it } from "vitest";
import { commandStepResult, reconExecutionResult, huntExecutionResult } from "@/server/scanners/result";
import { scanPresentation } from "@/lib/scanPresentation";
import type { HuntReport } from "@/lib/hunt/report";

function report(overrides: Partial<HuntReport> = {}): HuntReport {
  return { version: 1, status: "COMPLETED", startedAt: "2026-10-27T00:00:00Z", requests: 0, limits: {}, families: [], techniques: [], candidates: [], ...overrides };
}
const technique = (state: HuntReport["techniques"][number]["state"], reason = "") => ({ techniqueId: "test", family: "xss", title: "test", state, reason, requests: 0, referenceIds: [] });
describe("execution results", () => {
  it.each([
    [{ code: 0, timedOut: false }, "SUCCESS", undefined],
    [{ code: 1, timedOut: false }, "FAILED", "exit code 1"],
    [{ code: 0, timedOut: true }, "FAILED", "timeout after 100ms"],
    [{ code: null, timedOut: false }, "FAILED", "no exit code"],
    [{ code: null, timedOut: false, spawnFailed: true }, "FAILED", "failed to spawn"],
  ] as const)("interprets command result %j", (result, state, reason) => {
    const step = commandStepResult("httpx", result, 100);
    expect(step.state).toBe(state);
    if (reason) expect("reason" in step && step.reason).toContain(reason);
  });
  it("aggregates failures, useful partial work and deliberate skips", () => {
    const good = commandStepResult("katana", { code: 0, timedOut: false }, 100);
    const bad = commandStepResult("nmap", { code: null, timedOut: false }, 100);
    const skip = { step: "subfinder", state: "SKIPPED", reason: "policy" } as const;
    expect(reconExecutionResult([good, skip]).outcome).toBe("SUCCESS");
    expect(reconExecutionResult([good, bad]).outcome).toBe("PARTIAL");
    expect(reconExecutionResult([bad, skip]).outcome).toBe("FAILED");
  });
  it("Hunt completion without findings, policy or applicability skips is successful", () => {
    expect(huntExecutionResult(report({ techniques: [technique("SKIPPED", "NOT_APPLICABLE"), technique("SKIPPED", "FAMILY_ALREADY_CONFIRMED"), technique("COMPLETED")] }))).toEqual({ outcome: "SUCCESS" });
  });
  it.each(["ERROR", "LIMIT_REACHED", "WAITING"] as const)("Hunt %s reduces coverage after useful work", state => {
    expect(huntExecutionResult(report({ techniques: [technique("COMPLETED"), technique(state)] })).outcome).toBe("PARTIAL");
  });
  it("limits are partial after useful requests and failed before useful execution", () => {
    expect(huntExecutionResult(report({ status: "LIMIT_REACHED", execution: { successfulRequests: 1, failedRequests: 1, issues: [] } })).outcome).toBe("PARTIAL");
    expect(huntExecutionResult(report({ status: "LIMIT_REACHED" })).outcome).toBe("FAILED");
    expect(huntExecutionResult(report({ techniques: [technique("ERROR")] })).outcome).toBe("FAILED");
    expect(huntExecutionResult(report({ status: "FAILED", techniques: [technique("COMPLETED")] })).outcome).toBe("FAILED");
  });
  it("scope revocation is always a failure, including after useful work", () => {
    expect(huntExecutionResult(report({ status: "LIMIT_REACHED", execution: { successfulRequests: 2, failedRequests: 1, issues: ["SCOPE_REVOKED"] } })).outcome).toBe("FAILED");
  });
  it("discovery transport/auth failures and interrupted planned techniques are explicit", () => {
    expect(huntExecutionResult(report({ execution: { successfulRequests: 1, failedRequests: 1, issues: ["DISCOVERY_TRANSPORT_ERROR"] } })).outcome).toBe("PARTIAL");
    expect(huntExecutionResult(report({ techniques: [technique("COMPLETED"), technique("SKIPPED", "HUNT_FINISHED_OR_LIMIT_REACHED")] })).outcome).toBe("PARTIAL");
  });
});
describe("scan presentation", () => {
  it.each([
    ["QUEUED", null, "En attente", "neutral"],
    ["RUNNING", null, "En cours", "info"],
    ["COMPLETED", "SUCCESS", "Terminé", "passed"],
    ["COMPLETED", "PARTIAL", "Terminé partiellement", "medium"],
    ["FAILED", "FAILED", "Échec", "killed"],
    ["FAILED", "UNSUPPORTED", "Non pris en charge", "medium"],
    ["COMPLETED", null, "Terminé · résultat historique inconnu", "neutral"],
  ])("renders %s / %s", (status, outcome, label, tone) => {
    expect(scanPresentation(status!, outcome)).toEqual({ label, tone });
  });
  it("never shows live jobs as successful, even with an inconsistent outcome", () => {
    expect(scanPresentation("QUEUED", "SUCCESS").tone).not.toBe("passed");
    expect(scanPresentation("RUNNING", "SUCCESS").tone).not.toBe("passed");
  });
});
