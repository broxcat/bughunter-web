import { describe, expect, it } from "vitest";
import { commandStepResult, reconExecutionResult } from "@/server/scanners/result";
import { scanPresentation } from "@/lib/scanPresentation";

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
  it("distinguishes delivery pending from confirmed queue acceptance", () => {
    expect(scanPresentation("QUEUED", null, "PENDING")).toEqual({ label: "En attente de publication", tone: "medium" });
    expect(scanPresentation("QUEUED", null, "PUBLISHED")).toEqual({ label: "En file d’attente", tone: "neutral" });
    expect(scanPresentation("RUNNING", null, "PENDING").label).toBe("En cours");
  });
  it("shows interruption and cancellation request explicitly without claiming cancellation", () => {
    expect(scanPresentation("FAILED", "PARTIAL", "PUBLISHED", "INTERRUPTED")).toEqual({ label: "Exécution interrompue", tone: "killed" });
    expect(scanPresentation("RUNNING", null, "PUBLISHED", "RUNNING", true)).toEqual({ label: "Annulation demandée", tone: "medium" });
    expect(scanPresentation("CANCELLED", null, "PUBLISHED", "CANCELLED", true)).toEqual({ label: "Annulé", tone: "neutral" });
  });
  it("never shows live jobs as successful, even with an inconsistent outcome", () => {
    expect(scanPresentation("QUEUED", "SUCCESS").tone).not.toBe("passed");
    expect(scanPresentation("RUNNING", "SUCCESS").tone).not.toBe("passed");
  });
});
