import type { ScanExecutionResult } from "./result";
import { currentTargetExecution } from "@/server/execution";
import { withHuntSession, runFamilyTechniques } from "@/server/hunt/runtime";
import { startHuntSnapshot } from "@/server/hunt/snapshot";
// Hunt orchestrator. Runs the selected catalogue families.
//
// Returns the aggregate execution result to the queue worker;
// the families load their own context (targetId/userId) from the scanRunId. Each
// family is best-effort — one throwing must never abort the others or the run.

import { loadScanContext, logLine, type ScanContext } from "./context";
import { runAuthBypass } from "./auth-bypass";
import { runIdor } from "./idor";
import { runXss } from "./xss";
import { runSsrf } from "./ssrf";
import { runBola } from "./bola";
import { runCsrf } from "./csrf";
import { runSqli } from "./sqli";
import { runCommandInjection } from "./commandInjection";
import { runSsti } from "./ssti";
import { runCors } from "./cors";
import { runJwt } from "./jwt";
import { runOauth } from "./oauth";
import { runXxe } from "./xxe";
import { runLfi } from "./lfi";
import { runDeserialization } from "./deserialization";
import { runBusinessLogicRace } from "./businessLogicRace";
import { runBusinessLogicTamper } from "./businessLogicTamper";
import { runBusinessLogicWorkflow } from "./businessLogicWorkflow";

const FAMILIES: ReadonlyArray<readonly [string, (ctx: ScanContext) => Promise<void>]> = [
  ["auth-bypass", runAuthBypass],
  ["idor", runIdor],
  ["xss", runXss],
  ["ssrf", runSsrf],
  ["bola", runBola],
  ["csrf", runCsrf],
  ["sqli", runSqli],
  ["command-injection", runCommandInjection],
  ["ssti", runSsti],
  ["cors", runCors],
  ["jwt", runJwt],
  ["oauth", runOauth],
  ["xxe", runXxe],
  ["lfi", runLfi],
  ["deserialization", runDeserialization],
  ["business-logic-race", runBusinessLogicRace],
  ["business-logic-tamper", runBusinessLogicTamper],
  ["business-logic-workflow", runBusinessLogicWorkflow],
];


export async function runHunt(_host: string, scanRunId: string): Promise<ScanExecutionResult> {
  const ctx = await loadScanContext(scanRunId);
  if (!ctx) throw new Error("Missing scan context");
  const execution = currentTargetExecution();
  if (execution.targetId !== ctx.targetId || execution.host !== ctx.host) throw new Error("Target execution mismatch");
  await logLine(scanRunId, `[hunt] User-Agent: ${execution.requiredUserAgent}`);
  const snapshot = await startHuntSnapshot(scanRunId, execution);
  return withHuntSession(ctx, snapshot, async readiness => {
    const selected = new Set(readiness.families.filter(f => f.selected && f.safeSubset).map(f => f.family));
    for (const [name, run] of FAMILIES) {
      if (!selected.has(name)) continue;
      await run(ctx);
    }
    if (selected.has("information-disclosure")) await runFamilyTechniques(ctx, "information-disclosure");
  });
}
