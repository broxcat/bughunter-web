import { prisma } from '@/lib/prisma';
import { matchesHost, normalizeFqdn } from '@/lib/bountyProgram';
import { currentTargetExecution } from '../execution';
import { beforeScanNetwork, currentScanControl, recordUsefulScanWork, throwIfScanAborted } from '../scanControl';
import { logLine } from '../scanners/context';
import type { ScanExecutionResult } from '../scanners/result';

export function discoveryState(host: string, rules: readonly string[], exclusions: readonly string[]) {
  if (exclusions.some(r => matchesHost(host, r))) return 'EXCLUDED';
  return rules.some(r => matchesHost(host, r)) ? 'VALIDATED' : 'OUT_OF_SCOPE';
}
export async function persistProgramDiscovery(scanRunId: string, input: string, source: string) {
  let host: string;
  try { host = normalizeFqdn(input.trim()); if (host.startsWith('*.')) return null; } catch { return null; }
  return prisma.$transaction(async tx => {
    const run = await tx.scanRun.findUniqueOrThrow({ where: { id: scanRunId }, include: { target: true } });
    if (!run.target.contextOnly || !run.target.programId || run.type !== 'RECON') throw new Error('Invalid discovery context');
    const programId = run.target.programId;
    const locked = await tx.$queryRaw<{id:string}[]>`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${run.target.userId} AND "deletingAt" IS NULL FOR UPDATE`;
    if (!locked.length || run.cancelRequestedAt || run.status !== 'RUNNING') throw new Error('Recon stopped');
    const existing = await tx.hostDiscovery.findUnique({ where: { scanRunId_host: { scanRunId, host } } });
    if (existing) return { ...existing, firstObservation: false };
    const program = await tx.bountyProgram.findUniqueOrThrow({ where: { id: programId } });
    const state = discoveryState(host, program.scopeRules, program.outOfScope);
    let added = false;
    if (state === 'VALIDATED' && !await tx.target.findFirst({ where: { programId, host, active: true, contextOnly: false } })) {
      const scope = await tx.scope.create({ data: { userId: program.ownerId, hostPattern: host, programName: program.companyName, status: 'APPROVED', justification: `Explicit program scope; ${source}; ScanRun ${scanRunId}` } });
      await tx.target.create({ data: { userId: program.ownerId, programId, scopeId: scope.id, host, active: true, discoverySource: source, discoveredAt: new Date(), discoveredByScanRunId: scanRunId } });
      added = true;
    }
    return { ...await tx.hostDiscovery.create({ data: { scanRunId, host, source, state, added } }), firstObservation: true };
  });
}

/** Stream crt.sh JSON objects individually, bounded in size and time. No target
 * request, DNS probe, crawling, port scan or automatic scan of discoveries. */
export async function* certificateNames(response: Response) {
  if (!response.ok || !response.body) throw new Error('Certificate provider unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, depth = 0, quoted = false, escaped = false, item = '', started = false, ended = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength; if (bytes > 5 * 1024 * 1024) throw new Error('Certificate result limit exceeded');
      for (const c of decoder.decode(value, { stream: true })) {
        if (!depth) {
          if (/\s/.test(c)) continue;
          if (!started) { if (c !== '[') throw new Error('Invalid certificate response'); started = true; continue; }
          if (ended) throw new Error('Invalid certificate response');
          if (c === ']') { ended = true; continue; }
          if (c === ',') continue;
          if (c !== '{') throw new Error('Invalid certificate response');
        }
        item += c;
        if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
        else if (c === '"') quoted = true;
        else if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (!depth) {
            const entry = JSON.parse(item); item = '';
            if (typeof entry.name_value === 'string') for (const name of entry.name_value.split(/\r?\n/)) yield name;
          }
        }
      }
    }
    if (depth || quoted || !started || !ended) throw new Error('Incomplete certificate result');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function runProgramRecon(scanRunId: string): Promise<ScanExecutionResult> {
  const execution = currentTargetExecution();
  const program = await prisma.bountyProgram.findUniqueOrThrow({ where: { id: execution.programReconId } });
  if (program.deletingAt || !program.scopeRules.length) throw new Error('Program unavailable');
  let seen = 0, failures = 0;
  const discover = async (host: string, source: string) => {
    throwIfScanAborted();
    const row = await persistProgramDiscovery(scanRunId, host, source);
    if (row?.firstObservation) { seen++; await logLine(scanRunId, `[discovery] ${row.host}: ${row.state}${row.added ? ' (new host)' : ''}`); }
  };
  await logLine(scanRunId, '[recon] Program passive enumeration: scope seeds → certificate transparency → incremental inventory. No active scans.');
  for (const rule of program.scopeRules) if (!rule.startsWith('*.')) await discover(rule, 'SCOPE_RULE');
  for (const [index, rule] of program.scopeRules.slice(0, 50).entries()) {
    throwIfScanAborted();
    await logLine(scanRunId, `[recon] Certificate transparency ${index + 1}/${Math.min(program.scopeRules.length, 50)}: ${rule}`);
    const controller = new AbortController();
    const release = currentScanControl()?.track(async () => { controller.abort(); });
    try {
      await beforeScanNetwork();
      const url = new URL('https://crt.sh/'); url.searchParams.set('q', rule.startsWith('*.') ? `%${rule.slice(1)}` : rule); url.searchParams.set('output', 'json');
      const response = await fetch(url, { headers: { 'User-Agent': execution.requiredUserAgent }, redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000), ...(currentScanControl() ? [currentScanControl()!.signal] : [])]) });
      for await (const name of certificateNames(response)) { if (seen >= 10000) throw new Error('Discovery limit exceeded'); await discover(name, 'CERTIFICATE_TRANSPARENCY'); }
      await recordUsefulScanWork();
    } catch {
      throwIfScanAborted(); failures++;
      await logLine(scanRunId, '[recon] Certificate provider step incomplete; persisted discoveries retained', 'STDERR');
    } finally { controller.abort(); release?.(); }
  }
  const bounded = program.scopeRules.length > 50 || seen >= 10000;
  await logLine(scanRunId, `[recon] Enumeration finished: ${seen} observations; ${failures} incomplete steps`);
  return failures || bounded ? { outcome: 'PARTIAL', reason: 'Certificate provider unavailable or enumeration limit reached; inventory is partial' } : { outcome: 'SUCCESS' };
}
