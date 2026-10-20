// Minimal hunt port: run nuclei against the target host. Goes through
// runCommand (argv array, shell: false) so the host is never shell-interpreted.

import { runCommand } from "./runCommand";

const MINUTE = 60_000;

export async function runHunt(host: string, scanRunId: string): Promise<void> {
  // -u target, auto-updates disabled for a deterministic sandboxed run.
  await runCommand(
    "nuclei",
    ["-silent", "-no-color", "-duc", "-u", host],
    { scanRunId, timeoutMs: 15 * MINUTE },
  );
}
