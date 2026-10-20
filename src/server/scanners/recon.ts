// Minimal recon port: run the core discovery tools in sequence against one host.
// Every invocation goes through runCommand (argv arrays only, shell: false) so
// the host — user input — is never shell-interpreted. Tools run best-effort: a
// missing or failing tool records its outcome and we continue to the next.

import { runCommand } from "./runCommand";

const MINUTE = 60_000;

export async function runRecon(host: string, scanRunId: string): Promise<void> {
  const opts = (timeoutMs: number) => ({ scanRunId, timeoutMs });

  // Subdomain enumeration.
  await runCommand("subfinder", ["-silent", "-d", host], opts(10 * MINUTE));

  // Live host probing.
  await runCommand("httpx", ["-silent", "-u", host], opts(5 * MINUTE));

  // Service/version scan.
  await runCommand("nmap", ["-sV", "-Pn", host], opts(10 * MINUTE));

  // URL crawling.
  await runCommand("katana", ["-silent", "-u", host], opts(10 * MINUTE));
}
