// Hunt orchestrator. Runs the nuclei sweep, then the ported vuln-class families.
//
// Signature stays runHunt(host, scanRunId) so the QUEUE worker needs no change;
// the families load their own context (targetId/userId) from the scanRunId. Each
// family is best-effort — one throwing must never abort the others or the run.

import { runCommand } from "./runCommand";
import { loadScanContext, logLine, type ScanContext } from "./context";
import { runAuthBypass } from "./auth-bypass";
import { runIdor } from "./idor";

const MINUTE = 60_000;

const FAMILIES: ReadonlyArray<readonly [string, (ctx: ScanContext) => Promise<void>]> = [
  ["auth-bypass", runAuthBypass],
  ["idor", runIdor],
];

export async function runHunt(host: string, scanRunId: string): Promise<void> {
  // 1) nuclei sweep (argv array, shell:false — host never shell-interpreted).
  await runCommand(
    "nuclei",
    ["-silent", "-no-color", "-duc", "-u", host],
    { scanRunId, timeoutMs: 15 * MINUTE },
  );

  // 2) Ported vuln-class families.
  const ctx = await loadScanContext(scanRunId);
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
