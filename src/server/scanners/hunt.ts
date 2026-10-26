import { currentTargetExecution } from "@/server/execution";
import { familyAllowed } from "@/lib/bountyProgram";
import { NUCLEI_TEMPLATE } from "./toolPolicy";
// Hunt orchestrator. Runs the nuclei sweep, then the ported vuln-class families.
//
// Signature stays runHunt(host, scanRunId) so the QUEUE worker needs no change;
// the families load their own context (targetId/userId) from the scanRunId. Each
// family is best-effort — one throwing must never abort the others or the run.

import { runCommand } from "./runCommand";
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

const MINUTE = 60_000;

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


export const FAMILY_POLICY: Record<string, string[]> = {
  "auth-bypass": ["AUTHENTICATION", "ACCESS_CONTROL"], idor: ["IDOR", "ACCESS_CONTROL"],
  xss: ["XSS"], ssrf: ["SSRF"], bola: ["IDOR", "ACCESS_CONTROL"], csrf: ["CSRF"],
  sqli: ["SQL_INJECTION"], "command-injection": ["RCE"], ssti: ["SSTI", "RCE"],
  cors: ["CORS"], jwt: ["JWT", "AUTHENTICATION"], oauth: ["OAUTH", "AUTHENTICATION"],
  xxe: ["XXE"], lfi: ["LFI"], deserialization: ["DESERIALIZATION", "RCE"],
  "business-logic-race": ["BUSINESS_LOGIC"], "business-logic-tamper": ["BUSINESS_LOGIC"],
  "business-logic-workflow": ["BUSINESS_LOGIC"],
};

export async function runHunt(_host: string, scanRunId: string): Promise<void> {
  const ctx = await loadScanContext(scanRunId);
  if (!ctx) throw new Error("Missing scan context");
  const execution = currentTargetExecution();
  if (execution.targetId !== ctx.targetId) throw new Error("Target execution mismatch");
  await logLine(scanRunId, `[hunt] User-Agent: ${execution.requiredUserAgent}`);
  const allowed = (families: string[]) => familyAllowed(families, execution.qualifying, execution.nonQualifying);
  // Only an audited, same-host HTTP template. Arbitrary templates may dial other
  // hosts, invoke non-HTTP protocols or enable families excluded by the program.
  if (allowed(["INFORMATION_DISCLOSURE"])) await runCommand(
    "nuclei", ["-silent", "-no-color", "-duc", "-u", ctx.baseUrl, "-t", NUCLEI_TEMPLATE],
    { scanRunId, timeoutMs: 15 * MINUTE },
  );

  for (const [name, run] of FAMILIES) {
    if (!allowed(FAMILY_POLICY[name])) {
      await logLine(scanRunId, `[hunt] ${name} excluded by Target policy`);
      continue;
    }
    try {
      await run(ctx);
    } catch (err) {
      await logLine(
        scanRunId,
        `[hunt] ${name} errored: ${err instanceof Error ? err.message : String(err)}`,
        "STDERR",
      );
    }
  }
}
