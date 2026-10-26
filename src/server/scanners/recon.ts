import { analyzeCorpus, persistableCorpus } from "@/server/hunt/corpus";
import { discoverCorpus, clearDiscoveryCorpus } from "./discovery";
import { prisma } from "@/lib/prisma";
import { currentTargetExecution } from "@/server/execution";
import { resolveAny } from "node:dns/promises";
import { logLine } from "./context";
// Minimal recon port: run the core discovery tools in sequence against one host.
// Every invocation goes through runCommand (argv arrays only, shell: false) so
// the host — user input — is never shell-interpreted. Tools run best-effort: a
// missing or failing tool records its outcome and we continue to the next.
//
// Each tool gets the format it expects: subfinder -d and nmap take the bare
// domain (scheme stripped, :port stripped); httpx/katana take the full URL
// rebuilt from the target's stored scheme (falls back to https).

import { runCommand } from "./runCommand";
import { loadScanContext } from "./context";
import { loadTargetCredentials, credentialHeaders } from "@/server/credentials";

const MINUTE = 60_000;

export async function runRecon(_host: string, scanRunId: string): Promise<void> {
  const opts = (timeoutMs: number) => ({ scanRunId, timeoutMs });

  const execution = currentTargetExecution();
  const ctx = await loadScanContext(scanRunId);
  if (!ctx || execution.targetId !== ctx.targetId) throw new Error("Missing authorized scan context");
  await logLine(scanRunId, `[recon] User-Agent: ${execution.requiredUserAgent}`);
  const corpus = analyzeCorpus(await discoverCorpus(ctx), ctx.baseUrl);
  await prisma.scanRun.updateMany({ where: { id: scanRunId, targetId: ctx.targetId }, data: { reconCorpus: persistableCorpus(corpus) } });
  clearDiscoveryCorpus(scanRunId);
  const bareHost = ctx.host;
  const url = ctx.baseUrl;
  const domain = bareHost.split(":")[0]; // no port — subfinder/nmap want this

  // If the target has a credential, crawl authenticated so katana/httpx reach
  // session-gated routes (/dashboard, /courses, …). First credential is enough
  // for broad URL discovery. Passed as argv -H flags (never a shell string).
  // EMAIL_PASSWORD credentials auto-login here via loadTargetCredentials.
  const headerArgs: string[] = [];
  if (ctx) {
    try {
      const creds = await loadTargetCredentials(ctx.targetId);
      if (creds.length > 0) {
        for (const [k, v] of Object.entries(credentialHeaders(creds[0]))) {
          headerArgs.push("-H", `${k}: ${v}`);
        }
      }
    } catch {
      /* anonymous recon on failure */
    }
  }
  if (headerArgs.length > 0) {
    // (no cookie/token values logged — only that auth is in use)
    await logLine(scanRunId, "[recon] authenticated crawl enabled");
  }

  // DNS records only: discovered identities are never auto-authorized.
  // Passive provider HTTP has no reliable per-program UA control in subfinder.
  // DNS-only resolution performs no HTTP and does not authorize discovered hosts.
  await logLine(scanRunId, "[recon] subfinder disabled: provider HTTP cannot guarantee Target User-Agent; DNS resolution USER_AGENT_NOT_APPLICABLE");
  const records = await resolveAny(domain).catch(() => []);
  await logLine(scanRunId, `[dns] ${JSON.stringify(records)}`);

  // Live host probing — full URL (authenticated when a credential exists).
  await runCommand("httpx", ["-silent", "-u", url, ...headerArgs], opts(5 * MINUTE));

  // TCP connect scan only: no service/version detection or HTTP probes.
  await runCommand("nmap", ["-sT", "-Pn", "-n", domain], opts(10 * MINUTE));

  // URL crawling — full URL, depth 3 to reach dashboard sub-pages, authenticated
  // when a credential exists.
  await runCommand(
    "katana",
    ["-silent", "-u", url, "-d", "3", "-jc", ...headerArgs],
    opts(10 * MINUTE),
  );
}
