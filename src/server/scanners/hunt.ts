// Hunt orchestrator. Runs the nuclei sweep, then the ported vuln-class families.
//
// Signature stays runHunt(host, scanRunId) so the QUEUE worker needs no change;
// the families load their own context (targetId/userId) from the scanRunId. Each
// family is best-effort — one throwing must never abort the others or the run.

import { runCommand } from "./runCommand";
import { loadScanContext, logLine, toBaseUrl, type ScanContext } from "./context";
import { runAuthBypass } from "./auth-bypass";
import { runIdor } from "./idor";
import { runXss } from "./xss";
import { runSsrf } from "./ssrf";
import { runBola } from "./bola";
import { runCsrf } from "./csrf";

const MINUTE = 60_000;

const FAMILIES: ReadonlyArray<readonly [string, (ctx: ScanContext) => Promise<void>]> = [
  ["auth-bypass", runAuthBypass],
  ["idor", runIdor],
  ["xss", runXss],
  ["ssrf", runSsrf],
  ["bola", runBola],
  ["csrf", runCsrf],
];

export async function runHunt(host: string, scanRunId: string): Promise<void> {
  const ctx = await loadScanContext(scanRunId);
  // nuclei wants a full URL — rebuilt from the target's stored scheme.
  const url = ctx?.baseUrl ?? toBaseUrl(host);

  // 1) nuclei sweep (argv array, shell:false — host never shell-interpreted).
  await runCommand(
    "nuclei",
    ["-silent", "-no-color", "-duc", "-u", url],
    { scanRunId, timeoutMs: 15 * MINUTE },
  );

  // 2) Ported vuln-class families.
  if (!ctx) {
    await logLine(
      scanRunId,
      "[hunt] could not load scan context — skipping vuln-class families",
      "STDERR",
    );
    return;
  }

  for (const [name, run] of FAMILIES) {
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
