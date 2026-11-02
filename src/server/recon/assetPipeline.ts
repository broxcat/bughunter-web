import { Resolver } from 'node:dns/promises';
import { connect } from 'node:tls';
import { isIP } from 'node:net';
import { prisma } from '@/lib/prisma';
import { assetAllowsUrl } from '@/lib/scopeAssets';
import { assetReconPlan, RECON_STAGES, type ReconStage } from '@/lib/reconPipeline';
import { currentTargetExecution, withTargetExecution } from '../execution';
import { beforeScanNetwork, currentScanControl, recordUsefulScanWork, throwIfScanAborted } from '../scanControl';
import { runProgramRecon, persistProgramDiscovery } from './program';
import { discoverCorpus, clearDiscoveryCorpus } from '../scanners/discovery';
import { analyzeCorpus, persistableCorpus } from './corpus';
import { probe, type ProbeResult } from '../scanners/http';
import { runCommand } from '../scanners/runCommand';
import { commandStepResult, type ScanExecutionResult } from '../scanners/result';
import { safeObservationUrl, isSafeReadUrl } from '@/lib/observationSafety';
import { assetHostAllowed } from '../scopeAssets';
import { assetEvidenceSchema, type AssetEvidence } from './assetEvidence';

/** Checks the live asset before network work; no discovered value changes authorization. */
export async function assertLiveAsset() {
  const execution = currentTargetExecution(), boundary = execution.scopeAsset ?? execution.parentScopeAsset;
  if (!boundary) throw new Error('Asset context required');
  const asset = await prisma.scopeAsset.findUnique({ where: { id: boundary.id }, include: { program: true, executionTarget: { include: { scope: true } } } });
  if (!asset || !asset.active || asset.program.deletingAt || asset.normalizedValue !== boundary.normalizedValue || asset.executionTarget?.scope.status !== 'APPROVED') throw new Error('Scope asset authorization changed');
  if (!execution.programReconId && !assetHostAllowed(asset, execution.host.split(':')[0], asset.program.outOfScope)) throw new Error('Host is outside current asset scope');
  return asset;
}
async function tlsMetadata(host: string, port: number): Promise<AssetEvidence['hosts'][number]['tls']> {
  await beforeScanNetwork();
  return new Promise(resolve => {
    const socket = connect({ host, port, servername: host, rejectUnauthorized: true });
    let done = false;
    const release = currentScanControl()?.track(async () => { socket.destroy(); });
    const finish = (value?: AssetEvidence['hosts'][number]['tls']) => { if (done) return; done = true; socket.destroy(); release?.(); resolve(value); };
    socket.setTimeout(5000, () => finish()); socket.on('error', () => finish());
    socket.on('close', () => finish());
    socket.on('secureConnect', () => { const c = socket.getPeerCertificate(); finish(c.fingerprint256 ? { validFrom: c.valid_from, validTo: c.valid_to, fingerprint256: c.fingerprint256 } : undefined); });
  });
}
function httpMetadata(page: { url: string; status: number; headers: Record<string, string> }) {
  const url = safeObservationUrl(page.url); if (url.length > 2048) throw new Error('HTTP observation URL limit');
  const contentType = (page.headers['content-type'] ?? '').split(';')[0].toLowerCase();
  const auth = page.headers['www-authenticate'] ?? '';
  let redirect: string | undefined;
  try { if (page.headers.location) { const value = safeObservationUrl(new URL(page.headers.location, page.url).toString()); if (value.length <= 2048) redirect = value; } } catch { /* Malformed redirect never authorizes a follow-up. */ }
  return { url, method: 'GET' as const, statusCode: page.status,
    contentType: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType) ? contentType.slice(0, 100) : 'unknown', observedAt: new Date().toISOString(),
    authenticationSchemes: (['basic', 'bearer', 'digest', 'negotiate'] as const).filter(s => new RegExp(`(?:^|[, ])${s}\\b`, 'i').test(auth)),
    ...(redirect ? { redirect } : {}) };
}
export async function runAssetRecon(scanRunId: string): Promise<ScanExecutionResult> {
  const execution = currentTargetExecution(), asset = await assertLiveAsset(), plan = assetReconPlan({ format: asset.format, type: execution.scopeAsset!.type });
  const evidence: AssetEvidence = { version: 1, scopeAssetId: asset.id, bounded: false, historicalUrls: [], hosts: [] };
  let failures = 0, useful = false;
  await prisma.reconPipelineStep.createMany({ data: RECON_STAGES.map((name, position) => ({ scanRunId, name, position })), skipDuplicates: true });
  let hosts: string[] = [];
  const stage = async <T>(name: ReconStage, task: () => Promise<T>, skip?: string): Promise<T | undefined> => {
    throwIfScanAborted();
    if (!hosts.length && !['Discovery', 'Normalization', 'Research Context'].includes(name)) skip ??= 'No authorized concrete host available from discovery.';
    if (skip) { await prisma.reconPipelineStep.update({ where: { scanRunId_name: { scanRunId, name } }, data: { state: 'SKIPPED', reason: skip, finishedAt: new Date() } }); return; }
    await prisma.reconPipelineStep.update({ where: { scanRunId_name: { scanRunId, name } }, data: { state: 'RUNNING', startedAt: new Date() } });
    try {
      const value = await task();
      await prisma.reconPipelineStep.update({ where: { scanRunId_name: { scanRunId, name } }, data: { state: 'COMPLETED', finishedAt: new Date() } }); return value;
    } catch {
      throwIfScanAborted(); failures++;
      await prisma.reconPipelineStep.update({ where: { scanRunId_name: { scanRunId, name } }, data: { state: 'FAILED', reason: 'Step incomplete; retained available evidence. See original Recon logs.', finishedAt: new Date() } }); return;
    }
  };
  try {
    await stage('Discovery', async () => {
      if (plan.wildcard) {
        const result = await runProgramRecon(scanRunId);
        let archiveIncomplete = false;
        try {
          const archived = new Set<string>();
          const archiveResult = await runCommand('gau', [asset.normalizedValue.slice(2)], { scanRunId, timeoutMs: 30000, signal: currentScanControl()?.signal,
            onStdoutLine: async line => {
              if (line.length > 2048 || !/^https?:\/\/\S+$/.test(line)) return;
              if (archived.size >= 1000) { evidence.bounded = true; return; }
              try { const u = new URL(line); if (u.username || u.password) return; const safe = safeObservationUrl(line); if (safe.length > 2048) { evidence.bounded = true; return; } archived.add(safe); await persistProgramDiscovery(scanRunId, u.hostname, 'GAU'); } catch { /* Invalid or revoked discovery cannot authorize traffic. */ }
            } });
          evidence.historicalUrls = [...archived].sort();
          archiveIncomplete = commandStepResult('gau', archiveResult, 30000).state !== 'SUCCESS';
        } catch { throwIfScanAborted(); archiveIncomplete = true; }
        const discoveries = await prisma.hostDiscovery.findMany({ where: { scanRunId, state: 'VALIDATED' }, orderBy: { host: 'asc' }, take: plan.maxHosts + 1 });
        hosts = discoveries.filter(d => assetHostAllowed(asset, d.host, asset.program.outOfScope)).map(d => d.host);
        evidence.bounded ||= hosts.length > plan.maxHosts; hosts = hosts.slice(0, plan.maxHosts);
        if (result.outcome !== 'SUCCESS' || archiveIncomplete) throw new Error('Passive discovery incomplete');
      } else hosts = [asset.format === 'URL' ? new URL(asset.normalizedValue).hostname : asset.normalizedValue];
    });
    const rawPages = new Map<string, ProbeResult>();
    const contexts = new Map<string, { baseUrl: string; host: string; targetId: string; userId: string; scanRunId: string }>();
    for (const hostname of hosts) {
      const baseUrl = asset.format === 'URL' ? asset.normalizedValue : `https://${hostname}`;
      contexts.set(hostname, { baseUrl, host: new URL(baseUrl).host, targetId: execution.targetId, userId: asset.program.ownerId, scanRunId });
      evidence.hosts.push({ hostname, capturedAt: new Date().toISOString(), dns: [], http: [], ports: [], corpus: persistableCorpus(analyzeCorpus({ html: '', urls: [], pages: [], authenticated: false }, baseUrl)) });
    }
    const forHosts = async (task: (record: AssetEvidence['hosts'][number], ctx: NonNullable<ReturnType<typeof contexts.get>>) => Promise<void>) => {
      let failed = false;
      for (const record of evidence.hosts) {
        const ctx = contexts.get(record.hostname)!;
        await withTargetExecution({ ...execution, programReconId: undefined, host: ctx.host }, async () => {
          try { await assertLiveAsset(); await task(record, ctx); } catch { throwIfScanAborted(); failed = true; }
        });
      }
      if (failed) throw new Error('Some hosts incomplete');
    };
    await stage('DNS', () => forHosts(async record => {
      await beforeScanNetwork(); const resolver = new Resolver();
      const pending = resolver.resolveAny(record.hostname).catch(async () => {
        // Some resolvers refuse ANY while ordinary A/AAAA resolution works.
        const addresses = await Promise.allSettled([resolver.resolve4(record.hostname), resolver.resolve6(record.hostname)]);
        const values = addresses.flatMap(result => result.status === 'fulfilled' ? result.value.map(address => ({ address })) : []);
        if (!values.length && addresses.every(result => result.status === 'rejected')) throw new Error('DNS resolution incomplete');
        return values;
      });
      const release = currentScanControl()?.track(async () => { resolver.cancel(); await pending.catch(() => {}); });
      try {
        const rows = await pending;
        record.dns = rows.flatMap(row => 'address' in row && isIP(row.address) ? [row.address] : []).slice(0, 100);
        await recordUsefulScanWork(); useful = true;
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENODATA') throw e; }
      finally { release?.(); }
    }));
    await stage('HTTP probing', () => forHosts(async (record, ctx) => {
      let page = await probe(ctx.baseUrl, { timeoutMs: 10000 });
      if (asset.format !== 'URL') {
        const http = await probe(`http://${record.hostname}/`, { timeoutMs: 10000 });
        if (!http.error) { record.http.push(httpMetadata(http)); if (page.error) { page = http; ctx.baseUrl = `http://${record.hostname}/`; } }
      }
      if (page.error) throw new Error('HTTP observation unavailable');
      useful = true; rawPages.set(record.hostname, page); record.http.push(httpMetadata(page));
      const u = new URL(ctx.baseUrl);
      if (u.protocol === 'https:') record.tls = await tlsMetadata(u.hostname, Number(u.port || 443));
      if (!plan.guardedHttpOnly) {
        const result = await runCommand('httpx', ['-silent', '-u', ctx.baseUrl], { scanRunId, timeoutMs: 30000, signal: currentScanControl()?.signal });
        if (commandStepResult('httpx', result, 30000).state !== 'SUCCESS') throw new Error('httpx incomplete');
      }
    }));
    await stage('Ports', () => forHosts(async record => {
      const result = await runCommand('nmap', ['-sT', '-Pn', '-n', record.hostname], { scanRunId, timeoutMs: 30000, signal: currentScanControl()?.signal,
        onStdoutLine: async line => { const match = /^(\d{1,5})\/tcp\s+(open|closed|filtered)\s+([a-z0-9?/_-]{1,40})\s*$/.exec(line); if (match && Number(match[1]) <= 65535) record.ports.push({ port: Number(match[1]), state: match[2] as 'open' | 'closed' | 'filtered', serviceLabel: match[3] }); } });
      if (commandStepResult('nmap', result, 30000).state !== 'SUCCESS') throw new Error('nmap incomplete');
    }), plan.guardedHttpOnly || plan.api ? 'URL/API assets authorize scoped HTTP only; no host-wide port scan.' : undefined);
    await stage('Technology detection', async () => { for (const record of evidence.hosts) {
      const page = rawPages.get(record.hostname), ctx = contexts.get(record.hostname)!;
      if (page) record.corpus = persistableCorpus(analyzeCorpus({ html: page.body, urls: [page.url], pages: [page], authenticated: false }, ctx.baseUrl));
    } }, !rawPages.size ? 'No HTTP response available; no technology inferred.' : undefined);
    const corpora = new Map<string, ReturnType<typeof analyzeCorpus>>();
    await stage('Crawling', () => forHosts(async (record, ctx) => {
      const seeds = plan.documentation.map(path => new URL(path, ctx.baseUrl.endsWith('/') ? ctx.baseUrl : ctx.baseUrl + '/').toString()).filter(url => assetAllowsUrl(asset, url) && isSafeReadUrl(url));
      const raw = await discoverCorpus(ctx, seeds);
      // OpenAPI paths/methods are discovered declarations, never verified requests.
      for (const page of raw.pages ?? []) if (/json/i.test(page.headers['content-type'] ?? '')) {
        try {
          const spec = JSON.parse(page.body);
          if ((spec.openapi || spec.swagger) && spec.paths && typeof spec.paths === 'object') for (const path of Object.keys(spec.paths).slice(0, 100)) {
            const url = new URL(path, ctx.baseUrl).toString(); if (assetAllowsUrl(asset, url)) raw.urls.push(url);
          }
        } catch { /* Not an observed OpenAPI document. */ }
      }
      const corpus = analyzeCorpus(raw, ctx.baseUrl); corpora.set(record.hostname, corpus); record.corpus = persistableCorpus(corpus);
      record.http = [...new Map([...record.http, ...(raw.pages ?? []).filter(page => page.status >= 100 && page.status <= 599 && assetAllowsUrl(asset, page.url) && safeObservationUrl(page.url).length <= 2048).slice(0, 25).map(httpMetadata)].map(item => [item.url, item])).values()].slice(0, 25);
      useful ||= Boolean(raw.execution?.successfulRequests);
      if (raw.execution?.issues.length) throw new Error('Crawl partial');
      if (!plan.guardedHttpOnly) {
        const result = await runCommand('katana', ['-silent', '-u', ctx.baseUrl, '-d', '3', '-jc'], { scanRunId, timeoutMs: 30000, signal: currentScanControl()?.signal,
          onStdoutLine: async line => { if (line.length <= 2048 && /^https?:\/\/\S+$/.test(line) && assetAllowsUrl(asset, line) && new URL(line).host === ctx.host && raw.urls.length < 200) raw.urls.push(line); } });
        const enriched = analyzeCorpus(raw, ctx.baseUrl); corpora.set(record.hostname, enriched); record.corpus = persistableCorpus(enriched);
        if (commandStepResult('katana', result, 30000).state !== 'SUCCESS') throw new Error('katana incomplete');
      }
    }));
    await stage('Endpoint extraction', async () => { for (const c of corpora.values()) if (c.urls.length) useful = true; });
    await stage('Parameter extraction', async () => { for (const c of corpora.values()) if (c.queryInputs.length || c.forms.length) useful = true; });
    await stage('JavaScript analysis', async () => { for (const c of corpora.values()) if (c.jsUrls.length || c.surface.javascript) useful = true; });
    await stage('Normalization', async () => {
      const parsed = assetEvidenceSchema.parse(evidence);
      await prisma.scanRun.update({ where: { id: scanRunId }, data: { assetResults: parsed, ...(parsed.hosts.length === 1 ? { reconCorpus: parsed.hosts[0].corpus } : {}) } });
    });
    await stage('Research Context', async () => {}, 'Evidence is ready for Research. Explicit snapshot generation/refresh preserves running conversations.');
    return failures || evidence.bounded ? { outcome: useful ? 'PARTIAL' : 'FAILED', reason: 'Some Recon steps failed or bounded host coverage was reached; inspect the pipeline and retained evidence.' } : { outcome: 'SUCCESS' };
  } finally {
    clearDiscoveryCorpus(scanRunId);
    // Cancellation cannot leave apparently running pipeline stages behind.
    await prisma.reconPipelineStep.updateMany({ where: { scanRunId, state: { in: ['PENDING', 'RUNNING'] } }, data: { state: 'SKIPPED', reason: 'Execution stopped before this step completed.', finishedAt: new Date() } });
  }
}
