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
