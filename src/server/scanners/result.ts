import type { HuntReport } from "@/lib/hunt/report";
import type { RunCommandResult } from "./runCommand";

export type ScanExecutionResult =
  | { outcome: "SUCCESS"; reason?: never }
  | { outcome: "PARTIAL" | "FAILED" | "UNSUPPORTED"; reason: string };

export type ReconStepResult = { step: string } & (
  | { state: "SUCCESS" }
  | { state: "SKIPPED" | "PARTIAL" | "FAILED"; reason: string }
);

export function commandStepResult(step: string, result: RunCommandResult, timeoutMs: number): ReconStepResult {
  if (result.timedOut) return { step, state: "FAILED", reason: `timeout after ${timeoutMs}ms` };
  if (result.spawnFailed) return { step, state: "FAILED", reason: "failed to spawn (tool unavailable)" };
  if (result.code === null) return { step, state: "FAILED", reason: "no exit code (spawn failure or signal)" };
  if (result.code !== 0) return { step, state: "FAILED", reason: `exit code ${result.code}` };
  return { step, state: "SUCCESS" };
}

export function reconExecutionResult(steps: readonly ReconStepResult[]): ScanExecutionResult {
  const errors = steps.filter(s => s.state === "FAILED" || s.state === "PARTIAL");
  if (!errors.length) return { outcome: "SUCCESS" };
  return {
    outcome: steps.some(s => s.state === "SUCCESS" || s.state === "PARTIAL") ? "PARTIAL" : "FAILED",
    reason: errors.map(s => `${s.step}: ${"reason" in s ? s.reason : s.state}`).join("; "),
  };
}

/** Only execution failures reduce coverage; prerequisites/policy skips and lack of findings do not. */
export function huntExecutionResult(report: HuntReport): ScanExecutionResult {
  if (report.execution?.issues.includes("SCOPE_REVOKED") || report.techniques.some(t => t.reason === "SCOPE_REVOKED")) {
    return { outcome: "FAILED", reason: "Hunt authorization is no longer valid" };
  }
  if (["FAILED", "RUNNING", "CANCELLED", "INTERRUPTED"].includes(report.status)) return { outcome: "FAILED", reason: "Hunt execution failed before normal completion" };
  const interrupted = report.status === "LIMIT_REACHED"
    || report.techniques.some(t => ["ERROR", "LIMIT_REACHED", "WAITING", "RUNNING", "VALIDATING"].includes(t.state) || t.reason === "HUNT_FINISHED_OR_LIMIT_REACHED")
    || report.families.some(f => f.state === "LIMIT_REACHED" || f.state === "ERROR" || f.reason === "HUNT_FINISHED_OR_LIMIT_REACHED")
    || Boolean(report.execution?.issues.length);
  if (!interrupted) return { outcome: "SUCCESS" };
  const useful = (report.execution?.successfulRequests ?? 0) > 0 || report.techniques.some(t => t.state === "COMPLETED");
  const reasons = new Set([
    ...(report.status === "LIMIT_REACHED" ? ["HUNT_LIMIT_REACHED"] : []),
    ...(report.execution?.issues ?? []),
    ...report.techniques.filter(t => ["ERROR", "LIMIT_REACHED"].includes(t.state) || t.reason === "HUNT_FINISHED_OR_LIMIT_REACHED").map(t => `${t.techniqueId}: ${t.reason}`),
  ]);
  return { outcome: useful ? "PARTIAL" : "FAILED", reason: [...reasons].join("; ") || "Hunt coverage interrupted" };
}
