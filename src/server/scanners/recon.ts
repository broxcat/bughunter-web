import { currentScanControl, throwIfScanAborted, beforeScanNetwork, recordUsefulScanWork } from "@/server/scanControl";
import { commandStepResult, reconExecutionResult, type ReconStepResult, type ScanExecutionResult } from "./result";
import { analyzeCorpus, persistableCorpus } from "@/server/recon/corpus";
import { discoverCorpus, clearDiscoveryCorpus } from "./discovery";
import { prisma } from "@/lib/prisma";
import { acquireExecution, currentTargetExecution } from "@/server/execution";
import { Resolver } from "node:dns/promises";
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

const MINUTE = 60_000;

export async function runRecon(_host: string, scanRunId: string): Promise<ScanExecutionResult> {
  if (currentTargetExecution().scopeAsset) { const { runAssetRecon } = await import('../recon/assetPipeline'); return runAssetRecon(scanRunId); }
  if (currentTargetExecution().programReconId) { const { runProgramRecon } = await import('../recon/program'); return runProgramRecon(scanRunId); }
  const steps: ReconStepResult[] = [];
  const record = async (step: ReconStepResult) => {
    steps.push(step);
    await logLine(scanRunId, `[recon] ${step.step}: ${step.state === "SUCCESS" ? "completed" : step.reason}`, step.state === "FAILED" || step.state === "PARTIAL" ? "STDERR" : "STDOUT");
  };
  const command = async (name: string, args: string[], timeoutMs: number) => {
    throwIfScanAborted();
    try {
      await record(commandStepResult(name, await runCommand(name, args, { scanRunId, timeoutMs, signal: currentScanControl()?.signal }), timeoutMs));
      throwIfScanAborted();
    } catch {
      throwIfScanAborted();
      await record({ step: name, state: "FAILED", reason: "command execution failed" });
    }
  };

  throwIfScanAborted();
  const execution = currentTargetExecution();
  const ctx = await loadScanContext(scanRunId);
  if (!ctx || execution.targetId !== ctx.targetId || execution.host !== ctx.host) throw new Error("Missing authorized scan context");
  await logLine(scanRunId, `[recon] User-Agent: ${execution.requiredUserAgent}`);
  const corpus = analyzeCorpus(await discoverCorpus(ctx), ctx.baseUrl);
  const discovery = corpus.raw.execution;
  await record(discovery?.issues.length
    ? { step: "discovery", state: discovery.successfulRequests ? "PARTIAL" : "FAILED", reason: discovery.issues.join(", ") }
    : { step: "discovery", state: "SUCCESS" });
  await prisma.scanRun.updateMany({ where: { id: scanRunId, targetId: ctx.targetId }, data: { reconCorpus: persistableCorpus(corpus) } });
  clearDiscoveryCorpus(scanRunId);
  const bareHost = ctx.host;
  const url = ctx.baseUrl;
  const domain = bareHost.split(":")[0]; // no port — subfinder/nmap want this

  // Legacy Recon is anonymous. Explicit contextual mapping owns authentication;
  // credential material is never supplied to scanner argv or inherited flags.

  // DNS records only: discovered identities are never auto-authorized.
  // Passive subdomain enumeration belongs to program Recon. This host stage
  // remains confined to the selected concrete host.
  // DNS-only resolution performs no HTTP and does not authorize discovered hosts.
  await record({ step: "subfinder", state: "SKIPPED", reason: "performed in program Recon; selected-host discovery does not expand authorization; DNS resolution USER_AGENT_NOT_APPLICABLE" });
  try {
    throwIfScanAborted();
    await beforeScanNetwork();
    const resolver = new Resolver({ timeout: 2500, tries: 1 });
    const traffic = await acquireExecution({ tool: 'native-dns', dnsHost: domain }, AbortSignal.timeout(5000));
    const pending = resolver.resolveAny(domain);
    const release = currentScanControl()?.track(async () => { resolver.cancel(); await pending.catch(() => {}); });
    let records;
    try { records = await pending; } finally { await traffic(); release?.(); }
    await recordUsefulScanWork();
    await logLine(scanRunId, `[dns] ${JSON.stringify(records)}`);
    await record({ step: "dns", state: "SUCCESS" });
  } catch (err) {
    throwIfScanAborted();
    // No DNS records is a successful empty result. Resolver failures reduce coverage.
    await record((err as NodeJS.ErrnoException).code === "ENODATA"
      ? { step: "dns", state: "SUCCESS" }
      : { step: "dns", state: "FAILED", reason: "DNS resolution failed" });
  }

  // Live host probing remains anonymous.
  await command("httpx", ["-silent", "-u", url], 5 * MINUTE);

  // Port discovery is available through the individually metered Scope Asset pipeline.

  // Historical URL crawling remains anonymous.
  await command(
    "katana",
    ["-silent", "-u", url, "-d", "3", "-jc"],
    10 * MINUTE,
  );
  throwIfScanAborted();
  const result = reconExecutionResult(steps);
  await logLine(scanRunId, `[recon] result: ${result.outcome}`);
  return result;
}
