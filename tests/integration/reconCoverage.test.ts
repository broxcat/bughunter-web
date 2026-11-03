// Real PostgreSQL persistence + orchestrator, with explicitly simulated scanner
// and DNS/HTTP adapters. Native scanner acceptance lives in test:recon:toolchain.
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { ProbeResult } from '@/server/scanners/http';
import type { createReconRelay } from '@/server/recon/transport';
import type { runCommand } from '@/server/scanners/runCommand';
import type { ReconPlan } from '@/lib/reconPlanner';
const mocks = vi.hoisted(() => ({
  doctor: vi.fn(), probe: vi.fn(), command: vi.fn(), requests: [] as string[], closed: 0,
  relay: null as null | Awaited<ReturnType<typeof createReconRelay>>,
  mode: 'redirect' as 'redirect' | 'missing' | 'budget' | 'rate-limit' | 'optional' | 'transport' | 'dns-partial' | 'status-zero',
}));
vi.mock('@/server/queue/logBus', () => ({ publishScanLog: vi.fn(async () => {}) }));
vi.mock('@/server/recon/toolchain', () => ({ collectReconDoctor: mocks.doctor }));
vi.mock('@/server/scanners/http', () => ({ probe: mocks.probe }));
vi.mock('@/server/scanners/runCommand', () => ({ runCommand: mocks.command }));
vi.mock('@/server/recon/toolLimits', () => ({ withReconToolLease: async (_tool: string, signal: AbortSignal, work: (signal: AbortSignal) => Promise<unknown>) => work(signal) }));
vi.mock('@/server/recon/burpCollection', () => ({ collectRunBurp: vi.fn(async () => ({ status: 'UNAVAILABLE', observations: [] })) }));
vi.mock('node:dns/promises', () => ({ Resolver: class {
  resolve4 = async () => ['192.0.2.1'];
  resolve6 = async () => { if (mocks.mode === 'dns-partial') throw Object.assign(new Error('queryAaaa ETIMEOUT'), { code: 'ETIMEOUT' }); throw new Error('ENODATA'); };
  resolveCname = async () => { throw new Error('ENODATA'); };
  cancel() {}
} }));
vi.mock('@/server/recon/transport', () => ({ createReconRelay: async (...args: Parameters<typeof createReconRelay>) => {
  const [execution, targetUrl, protection, signal, onResponse, budget] = args;
  const { assetAllowsUrl } = await import('@/lib/scopeAssets');
  const origin = 'http://127.0.0.1:9123', remote = new URL(targetUrl);
  const relay = {
    origin,
    mapUrl(raw: string) { const url = new URL(raw); if (url.origin !== origin) throw new Error('SCOPE_BLOCKED'); return remote.origin + url.pathname + url.search; },
    toRelay(raw: string) { if (!assetAllowsUrl(execution.scopeAsset!, raw)) throw new Error('SCOPE_BLOCKED'); const url = new URL(raw); return origin + url.pathname + url.search; },
    async request(url: string): Promise<ProbeResult> {
      signal.throwIfAborted();
      if (!assetAllowsUrl(execution.scopeAsset!, url)) throw new Error('SCOPE_BLOCKED');
      if (protection.blocked) throw new Error('BLOCKED: ' + protection.reason);
      if (budget.remaining-- <= 0) { protection.blocked = true; protection.reason = 'Asset request budget exhausted'; throw new Error('RESOURCE_LIMIT: request budget'); }
      const page = await mocks.probe(url); protection.observe(page.error ? undefined : page.status, page.error); await onResponse(page); return page;
    },
    async close() { mocks.closed++; },
  };
  mocks.relay = relay; return relay;
} }));
const db = process.env.TEST_DATABASE_URL, schema = 'coverage_' + randomUUID().replaceAll('-', '');
if (db) { const url = new URL(db); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.toString(); }
let p: typeof import('@/lib/prisma').prisma, execute: typeof import('@/server/recon/assetPipeline').runAssetRecon;
let context: typeof import('@/server/execution'), planner: typeof import('@/lib/reconPlanner');
let programId: string, assetId: string, targetId: string, runId: string, plan: ReconPlan;
function response(url: string): ProbeResult {
  const u = new URL(url); mocks.requests.push(url);
  if(mocks.mode==='status-zero')return{url,method:'GET',status:0,body:'',bodyLen:0,ms:1,headers:{}};
  const negative = u.pathname.includes('__bughunter_');
  const real = u.pathname === '/app/' || /\/(?:login|admin|api\/docs)$/.test(u.pathname);
  if(mocks.mode==='transport'&&!negative&&u.pathname!=='/app/')return{url,method:'GET',status:0,body:'',bodyLen:0,ms:1,headers:{},error:'ECONNRESET'};
  const status = mocks.mode === 'rate-limit' && negative ? 429 : !real ? 307 : 200;
  const body = real ? '<html><title>Local fixture</title><a href="/app/login">login</a><a href="/app/api/docs">API</a><a href="http://outside.test/outside">documentary</a></html>' : '';
  return { url, method: 'GET', status, body, bodyLen: Buffer.byteLength(body), ms: 1,
    headers: { 'content-type': 'text/html', ...(status === 307 ? { location: '/login?callbackUrl=' + encodeURIComponent(u.pathname) } : {}) } };
}
(db ? describe : describe.skip)('coverage-oriented Recon persistence with simulated adapters', () => {
  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma: p } = await import('@/lib/prisma')); context = await import('@/server/execution'); planner = await import('@/lib/reconPlanner');
    ({ runAssetRecon: execute } = await import('@/server/recon/assetPipeline'));
  }, 30000);
  beforeEach(async () => {
    mocks.mode = 'redirect'; mocks.requests = []; mocks.closed = 0; mocks.relay = null;
    const user = await p.user.create({ data: { email: randomUUID() + '@example.test' } });
    programId = (await p.bountyProgram.create({ data: { ownerId: user.id, companyName: 'Coverage fixture', requiredUserAgent: 'Coverage-Fixture/1' } })).id;
    const asset = await p.scopeAsset.create({ data: { programId, originalValue: 'http://app.recon.test/app/', normalizedValue: 'http://app.recon.test/app/', format: 'URL', type: 'WEB_APPLICATION', assetValue: 'LOW' } }); assetId = asset.id;
    const scope = await p.scope.create({ data: { userId: user.id, hostPattern: 'app.recon.test', status: 'APPROVED' } });
    targetId = (await p.target.create({ data: { userId: user.id, programId, scopeAssetId: assetId, scopeId: scope.id, host: 'app.recon.test', scheme: 'http', active: false } })).id;
    plan = planner.buildReconPlan(asset, { active: true, exclusions: [] });
    runId = (await p.scanRun.create({ data: { targetId, scopeAssetId: assetId, type: 'RECON', status: 'RUNNING', reconPlan: plan as unknown as import('@prisma/client').Prisma.InputJsonValue } })).id;
    mocks.probe.mockImplementation(async (url: string) => response(url));
    mocks.doctor.mockImplementation(async () => ({ ready: true, checks: {}, fingerprint: 'controlled-test-manifest', tools: Object.fromEntries(['httpx', 'nuclei', 'ffuf', 'gobuster'].map(tool => [tool, { available: !(['missing', 'budget'].includes(mocks.mode) && ['gobuster', 'ffuf'].includes(tool)) && !(mocks.mode === 'optional' && tool === 'nuclei'), capable: true, version: 'simulated-adapter' }])) }));
    mocks.command.mockImplementation(async (tool: string, _args: string[], options: Parameters<typeof runCommand>[2]) => {
      const ctx = context.currentTargetExecution(), relay = mocks.relay!;
      if (tool === 'httpx') { const page = await relay.request(ctx.reconRelayTarget!); await options?.onStdoutLine?.(JSON.stringify({ url: relay.toRelay(page.url), status_code: page.status, content_type: 'text/html' })); }
      if (tool === 'ffuf' || tool === 'gobuster') {
        const words = (await readFile((tool === 'ffuf' ? ctx.ffufWordlist : ctx.gobusterWordlist)!, 'utf8')).trim().split('\n');
        const base = ctx.reconRelayTarget!.endsWith('/') ? ctx.reconRelayTarget! : ctx.reconRelayTarget! + '/';
        for (const word of words) {
          const page = await relay.request(new URL(word, base).toString());
          if (page.status === 307) continue; // Simulated autocalibration omits equivalent redirects.
          await options?.onStdoutLine?.(tool === 'ffuf' ? JSON.stringify({ url: relay.toRelay(page.url), status: page.error?502:page.status, 'content-type': 'text/html' }) : `${relay.toRelay(page.url)} (Status: ${page.status}) [Size: ${page.bodyLen}]`);
        }
      }
      return { code: 0, timedOut: false, spawnFailed: false, cancelled: false };
    });
  });
  afterAll(async () => { if (p) { await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await p.$disconnect(); } });
  async function run() { const ctx = await context.loadTargetExecution(targetId, 'RECON', plan); return context.withTargetExecution(ctx, () => execute(runId)); }
  const step = () => p.reconPipelineStep.findUniqueOrThrow({ where: { scanRunId_name: { scanRunId: runId, name: 'Content discovery' } } });
  it('skips Gobuster for wildcard 307 redirects, completes with FFUF fallback and retains no negative-control artifacts', async () => {
    const result = await run(); expect(result.outcome).toBe('SUCCESS'); expect(await step()).toMatchObject({ state: 'COMPLETED_WITH_FALLBACK' });
    const details = (await step()).details as unknown as { capabilities: { capability: string; state: string; fallbacks: string[] }[] };
    expect(details.capabilities.find(c => c.capability === 'CONTENT_DISCOVERY')).toMatchObject({ state: 'COMPLETED_WITH_FALLBACK', fallbacks: ['ffuf'] });
    expect(mocks.command.mock.calls.some(call => call[0] === 'gobuster')).toBe(false); expect(mocks.command.mock.calls.some(call => call[0] === 'ffuf')).toBe(true);
    const rows = await p.reconArtifact.findMany({ where: { scanRunId: runId } }); expect(JSON.stringify(rows)).not.toContain('__bughunter_'); expect(rows.some(a => a.kind === 'endpoint')).toBe(true);
    expect(mocks.requests.every(url => planner.reconUrlAllowed(plan, url))).toBe(true); expect(mocks.closed).toBe(1);
  });
  it('lets calibrated native bounded enumeration satisfy coverage when both directory CLIs are unavailable', async () => {
    mocks.mode = 'missing'; const result = await run(); expect(result.outcome).toBe('SUCCESS'); expect(await step()).toMatchObject({ state: 'COMPLETED_WITH_FALLBACK' });
    expect(JSON.stringify((await step()).details)).toContain('CALIBRATED_ENUMERATION'); expect(mocks.closed).toBe(1);
  });
  it('keeps partial coverage when native fallback cannot finish its bounded request objective', async () => {
    mocks.mode = 'budget'; plan.limits.maxRequests = 5; await p.scanRun.update({ where: { id: runId }, data: { reconPlan: plan as unknown as import('@prisma/client').Prisma.InputJsonValue } });
    expect((await run()).outcome).toBe('PARTIAL'); expect(['PARTIAL', 'BLOCKED']).toContain((await step()).state); expect(mocks.closed).toBe(1);
  });
  it('does not downgrade required coverage because optional Nuclei/Burp enrichment is unavailable', async () => {
    mocks.mode = 'optional'; expect((await run()).outcome).toBe('SUCCESS');
    const rows = await p.reconPipelineStep.findMany({ where: { scanRunId: runId, name: { in: ['Nuclei Recon', 'Burp enrichment'] } } });
    expect(rows.every(row => row.state !== 'COMPLETED')).toBe(true); expect((await step()).state).toBe('COMPLETED_WITH_FALLBACK');
  });
  it('stops on a 429 calibration response and records blocked rather than a clean empty inventory', async () => {
    mocks.mode = 'rate-limit'; expect((await run()).outcome).toBe('PARTIAL'); const row=await step();expect(row.state,row.reason??JSON.stringify(row.details)).toBe('BLOCKED');
    expect(mocks.requests.filter(url => url.includes('__bughunter_'))).toHaveLength(1); expect(mocks.command.mock.calls.some(call => call[0] === 'ffuf')).toBe(false); expect(mocks.closed).toBe(1);
  });
  it('cannot count failed relay transport requests as completed coverage or observed target 502 responses',async()=>{
    mocks.mode='transport';expect((await run()).outcome).toBe('PARTIAL');
    const rows=await p.reconArtifact.findMany({where:{scanRunId:runId,kind:'endpoint'}});
    expect(rows.some(row=>(row.value as {statusCode?:number}).statusCode===502)).toBe(false);
    expect((await step()).state).not.toBe('COMPLETED');expect(mocks.closed).toBe(1);
  });
  it('does not let a successful A record hide an incomplete AAAA lookup', async () => {
    mocks.mode = 'dns-partial'; expect((await run()).outcome).toBe('PARTIAL');
    const row = await p.reconPipelineStep.findUniqueOrThrow({ where: { scanRunId_name: { scanRunId: runId, name: 'Scope validation / DNS' } } });
    expect(row.state).toBe('PARTIAL'); expect(JSON.stringify(row.details)).toContain('ETIMEOUT');
    expect(JSON.stringify(row.details)).toContain('incompleteDnsHosts'); expect((await step()).state).toBe('COMPLETED_WITH_FALLBACK');
  });
  it('never treats status zero without an error string as a verified live service', async () => {
    mocks.mode = 'status-zero'; expect((await run()).outcome).toBe('PARTIAL');
    expect(mocks.command.mock.calls.some(call => ['httpx', 'ffuf', 'gobuster', 'nuclei'].includes(call[0]))).toBe(false);
    expect(await p.reconArtifact.count({ where: { scanRunId: runId, kind: 'endpoint' } })).toBe(0);
    const row = await p.reconPipelineStep.findUniqueOrThrow({ where: { scanRunId_name: { scanRunId: runId, name: 'HTTP surface' } } });
    expect(row.state).toBe('PARTIAL');
  });
  it('persists the interrupted preflight cause with credential redaction', async () => {
    mocks.doctor.mockRejectedValueOnce(new Error('INCOMPATIBLE_TOOL: required temporary directory unavailable; token=PRIVATE_FIXTURE_SECRET'));
    expect((await run()).outcome).toBe('FAILED');
    const row = await p.scanRun.findUniqueOrThrow({ where: { id: runId }, select: { error: true } });
    expect(row.error).toContain('INCOMPATIBLE_TOOL'); expect(row.error).toContain('temporary directory unavailable'); expect(row.error).not.toContain('PRIVATE_FIXTURE_SECRET');
    const logs = await p.scanLog.findMany({ where: { scanRunId: runId }, select: { line: true } });
    expect(logs.some(log => log.line.includes('Recon interrupted') && log.line.includes('INCOMPATIBLE_TOOL'))).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('PRIVATE_FIXTURE_SECRET');
  });

});
