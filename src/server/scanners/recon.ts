// Minimal recon port: run the core discovery tools in sequence against one host.
// Every invocation goes through runCommand (argv arrays only, shell: false) so
// the host — user input — is never shell-interpreted. Tools run best-effort: a
// missing or failing tool records its outcome and we continue to the next.
//
// Each tool gets the format it expects: subfinder -d and nmap take the bare
// domain (scheme stripped, :port stripped); httpx/katana take the full URL
// rebuilt from the target's stored scheme (falls back to https).

import { runCommand } from "./runCommand";
import { loadScanContext, toBaseUrl } from "./context";

const MINUTE = 60_000;

export async function runRecon(host: string, scanRunId: string): Promise<void> {
  const opts = (timeoutMs: number) => ({ scanRunId, timeoutMs });

  const ctx = await loadScanContext(scanRunId);
  const bareHost = ctx?.host ?? host; // stored bare host, may include :port
  const url = ctx?.baseUrl ?? toBaseUrl(host); // scheme://host
  const domain = bareHost.split(":")[0]; // no port — subfinder/nmap want this

  // Subdomain enumeration — bare domain only.
  await runCommand("subfinder", ["-silent", "-d", domain], opts(10 * MINUTE));

  // Live host probing — full URL.
  await runCommand("httpx", ["-silent", "-u", url], opts(5 * MINUTE));

  // Service/version scan — host/IP, no scheme or port.
  await runCommand("nmap", ["-sV", "-Pn", domain], opts(10 * MINUTE));

  // URL crawling — full URL.
  await runCommand("katana", ["-silent", "-u", url], opts(10 * MINUTE));
}
