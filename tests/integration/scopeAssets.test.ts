import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), publish: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/server/queue/scanJobPublisher', () => ({ publishScanJob: mocks.publish, dispatchSelect: { status: true, attempts: true, lastError: true, nextAttemptAt: true, publishedAt: true } }));
const db = process.env.TEST_DATABASE_URL, schema = 'scopeassets_' + randomUUID().replaceAll('-', '');
if (db) { const url = new URL(db); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.toString(); }
let p: typeof import('@/lib/prisma').prisma, service: typeof import('@/server/scopeAssets'), markdown: typeof import('@/server/scopeMarkdown');
let api: typeof import('@/app/api/programs/[id]/assets/route'), edit: typeof import('@/app/api/programs/[id]/assets/[assetId]/route'), recon: typeof import('@/app/api/programs/[id]/assets/[assetId]/recon/route');
let parentRecon:typeof import('@/app/api/programs/[id]/recon/route');
let userId: string, otherId: string, programId: string;
const context = (assetId = '') => ({ params: Promise.resolve({ id: programId, assetId }) });
const request = (body?: unknown, method = 'POST', origin = 'http://app.example.test') => new Request('http://app.example.test/api', { method, headers: { Origin: origin }, ...(body ? { body: JSON.stringify(body) } : {}) });
(db ? describe : describe.skip)('Target Scope Asset PostgreSQL workflow', () => {
  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma: p } = await import('@/lib/prisma')); service = await import('@/server/scopeAssets'); markdown = await import('@/server/scopeMarkdown');
    parentRecon=await import('@/app/api/programs/[id]/recon/route');
    api = await import('@/app/api/programs/[id]/assets/route'); edit = await import('@/app/api/programs/[id]/assets/[assetId]/route'); recon = await import('@/app/api/programs/[id]/assets/[assetId]/recon/route');
    process.env.AUTH_URL = 'http://app.example.test';
    otherId = (await p.user.create({ data: { email: randomUUID() + '@example.test' } })).id;
  }, 30000);
  beforeEach(async () => {
    userId = (await p.user.create({ data: { email: randomUUID() + '@example.test' } })).id;
    programId = (await p.bountyProgram.create({ data: { ownerId: userId, companyName: 'Équipe | asset fixture', requiredUserAgent: 'Asset-Fixture/1', scopeRules: [], outOfScope: ['excluded.example.test'] } })).id;
    mocks.auth.mockResolvedValue({ user: { id: userId } }); mocks.publish.mockReset().mockResolvedValue({ dispatch: 'PENDING' });
  });
  afterAll(async () => { if (p) { await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await p.$disconnect(); } });
  const create = async (value = 'https://app.example.test/api', extra = {}) => {
    const response = await api.POST(request({ value, ...extra }), context()); expect(response.status).toBe(201); return response.json();
  };
  it('persists original input, normalized format, suggested type and Medium default, with explicit overrides', async () => {
    const asset = await create('www\\.vfsvisaonline.com'); expect(asset).toMatchObject({ originalValue: 'www\\.vfsvisaonline.com', normalizedValue: 'www.vfsvisaonline.com', format: 'SUBDOMAIN', type: 'WEB_APPLICATION', assetValue: 'MEDIUM', typeSource: 'HEURISTIC' });
    const response = await edit.PATCH(request({ type: 'API', assetValue: 'CRITICAL' }, 'PATCH'), context(asset.id)); expect(response.status).toBe(200);
    expect(await p.scopeAsset.findUniqueOrThrow({ where: { id: asset.id } })).toMatchObject({ type: 'API', assetValue: 'CRITICAL', typeSource: 'USER' });
    expect((await api.POST(request({ value: 'WWW.VFSVISAONLINE.COM' }), context())).status).toBe(409);
  });
  it('backfills only official entries and explicit legacy hosts, preserving IDs/results and user metadata', async () => {
    await p.bountyProgram.update({ where: { id: programId }, data: { scopeRules: ['*.example.test'] } });
    const scope = await p.scope.create({ data: { userId, hostPattern: 'app.example.test', status: 'APPROVED' } });
    const host = await p.target.create({ data: { userId, programId, scopeId: scope.id, host: 'app.example.test' } });
    const old = await p.scanRun.create({ data: { targetId: host.id, type: 'RECON', status: 'COMPLETED' } });
    await p.target.create({ data: { userId, programId, scopeId: scope.id, host: 'discovered.example.test', discoverySource: 'SUBFINDER' } });
    let rows = await service.listScopeAssets(userId, programId); expect(rows.map(r => r.normalizedValue).sort()).toEqual(['*.example.test', 'app.example.test']);
    const item = rows.find(r => r.normalizedValue === host.host)!; expect(item.executionTarget?.id).toBe(host.id);
    await service.editScopeAsset(userId, programId, item.id, { type: 'API', assetValue: 'HIGH' }); rows = await service.listScopeAssets(userId, programId);
    expect(rows.find(r => r.id === item.id)).toMatchObject({ type: 'API', assetValue: 'HIGH' }); expect((await p.scanRun.findUniqueOrThrow({ where: { id: old.id } })).reconCorpus).toBeNull();
  });
  it('starts immutable asset plans through Target-wide Recon and retires asset-specific creation', async () => {
    const asset = await create('https://app.example.test:8443/app', { type: 'API', assetValue: 'HIGH' });
    expect((await recon.POST(request(), context(asset.id))).status).toBe(410);
    const first=await parentRecon.POST(request(),context());expect(first.status).toBe(202);const parent=await first.json(),run=await p.scanRun.findFirstOrThrow({where:{targetReconRunId:parent.id},include:{reconSteps:true}});
    expect(run).toMatchObject({scopeAssetId:asset.id,scopeAssetSnapshot:{normalizedValue:asset.normalizedValue,type:'API',assetValue:'HIGH'}});expect(run.reconSteps).toHaveLength(12);
    expect((await (await parentRecon.POST(request(),context())).json()).id).toBe(parent.id);
    await service.editScopeAsset(userId,programId,asset.id,{assetValue:'LOW'});expect((await p.scanRun.findUniqueOrThrow({where:{id:run.id}})).scopeAssetSnapshot).toMatchObject({assetValue:'HIGH'});
    await p.scanRun.update({where:{id:run.id},data:{status:'COMPLETED',outcome:'PARTIAL',finishedAt:new Date()}});
    expect((await service.listScopeAssets(userId,programId))[0].reconStatus).toBe('PARTIAL');
    const {reconcileTargetRecon}=await import('@/server/recon/targetRuns');await reconcileTargetRecon(parent.id);
    const newer=await (await parentRecon.POST(request(),context())).json();expect(newer.id).not.toBe(parent.id);
    expect((await edit.DELETE(request(undefined,'DELETE'),context(asset.id))).status).toBe(200);expect((await p.scanRun.findFirstOrThrow({where:{targetReconRunId:newer.id}})).status).toBe('CANCELLED');
  });
  it('keeps URL assets on the same host as distinct execution identities and immutable scope boundaries', async () => {
    const a = await create('https://app.example.test/app'), b = await create('https://app.example.test/admin');
    const aa = await service.ensureAssetExecution(userId, programId, a.id), bb = await service.ensureAssetExecution(userId, programId, b.id);
    expect(aa.target.id).not.toBe(bb.target.id); expect(aa.target.host).toBe(bb.target.host);
    const { loadTargetExecution, assertExecutionUrl } = await import('@/server/execution');
    const execution = await loadTargetExecution(aa.target.id, 'RECON');
    expect(() => assertExecutionUrl('https://app.example.test/app/users', execution)).not.toThrow(); expect(() => assertExecutionUrl('https://app.example.test/admin', execution)).toThrow();
  });
  it('returns owned scope downloads with deterministic content, provenance, escaping and safe headers', async () => {
    const a = await create('https://app.example.test/app', { assetValue: 'CRITICAL' });
    const response = await markdown.scopeMarkdownDownload(userId, programId, a.id); expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/markdown'); expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="asset-[a-z0-9-]+-scope.md"$/);
    const text = await response.text(); expect(text).toContain(a.id); expect(text).toContain('Target ID: ' + programId); expect(text).toContain('No data collected yet.'); expect(text).toContain('Équipe \\| asset fixture'); expect(text).toContain('LLM Safety Boundary');
    expect(await (await markdown.scopeMarkdownDownload(userId, programId, a.id)).text()).toBe(text);
    const global = await (await markdown.scopeMarkdownDownload(userId, programId)).text(); expect(global).toContain('# BugHunter Scope'); expect(global).toContain('CRITICAL'); expect(global).toContain(a.id);
    expect((await markdown.scopeMarkdownDownload(otherId, programId, a.id)).status).toBe(404);
  });
  it('archives authorization while preserving Recon and preventing subsequent execution', async () => {
    const a = await create('api.example.test'); const { target } = await service.ensureAssetExecution(userId, programId, a.id);
    const run = await p.scanRun.create({ data: { targetId: target.id, scopeAssetId: a.id, type: 'RECON', status: 'COMPLETED', outcome: 'SUCCESS', finishedAt: new Date('2026-01-01') } });
    expect((await service.listScopeAssets(userId, programId))[0].reconStatus).toBe('STALE');
    expect((await edit.DELETE(request(undefined, 'DELETE'), context(a.id))).status).toBe(200);
    expect((await p.scanRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('COMPLETED'); expect((await recon.GET(new Request('http://app.example.test'), context(a.id))).status).toBe(200);
    expect((await service.listScopeAssets(userId, programId))[0].active).toBe(false);
  });
  it('rejects foreign ownership/origin, invalid overrides and unsupported network formats', async () => {
    const a = await create();
    expect((await edit.PATCH(request({ assetValue: 'SUPER' }, 'PATCH'), context(a.id))).status).toBe(400);
    expect((await api.POST(request({ value: 'other.example.test' }, 'POST', 'https://foreign.test'), context())).status).toBe(403);
    mocks.auth.mockResolvedValue({ user: { id: otherId } }); expect((await api.GET(new Request('http://app.example.test'), context())).status).toBe(404); expect((await edit.PATCH(request({ type: 'API' }, 'PATCH'), context(a.id))).status).toBe(404); expect((await recon.GET(new Request('http://app.example.test'), context(a.id))).status).toBe(404);
    mocks.auth.mockResolvedValue(null); expect((await api.GET(new Request('http://app.example.test'), context())).status).toBe(401);
  });
  it('replaces a technical boundary explicitly, preserves old plans and can reauthorize the original identity',async()=>{
    const a=await create('example.test');
    const before=await parentRecon.POST(request(),context());expect(before.status).toBe(202);const parent=await before.json();
    const old=await p.scanRun.findFirstOrThrow({where:{scopeAssetId:a.id}}),captured=old.reconPlan;
    expect((await edit.PATCH(request({format:'WILDCARD_DOMAIN'},'PATCH'),context(a.id))).status).toBe(409);
    expect((await edit.PATCH(request({format:'WILDCARD_DOMAIN',confirmBoundaryChange:true},'PATCH'),context(a.id))).status).toBe(409);
    const response=await edit.POST(request({value:'example.test',format:'WILDCARD_DOMAIN',expectedUpdatedAt:a.updatedAt,confirmReplacement:true}),context(a.id));expect(response.status).toBe(201);const{asset:replacement}=await response.json();
    const reloaded=await service.listScopeAssets(userId,programId);expect(reloaded.find(i=>i.id===replacement.id)).toMatchObject({normalizedValue:'*.example.test',format:'WILDCARD_DOMAIN',formatSource:'MANUAL',active:true});expect(reloaded.find(i=>i.id===a.id)).toMatchObject({normalizedValue:'example.test',format:'DOMAIN',active:false});
    expect((await p.scanRun.findUniqueOrThrow({where:{id:old.id}})).reconPlan).toEqual(captured);
    const {loadTargetExecution}=await import('@/server/execution');await expect(loadTargetExecution(old.targetId,'RECON',captured as unknown as import('@/lib/reconPlanner').ReconPlan)).rejects.toThrow(/archived/);
    await(await import('@/server/recon/targetRuns')).reconcileTargetRecon(parent.id);
    const next=await parentRecon.POST(request(),context());expect(next.status).toBe(202);
    const run=await p.scanRun.findFirstOrThrow({where:{scopeAssetId:replacement.id}});expect(run.scopeAssetSnapshot).toMatchObject({format:'WILDCARD_DOMAIN',formatSource:'MANUAL'});
    expect((await edit.PATCH(request({resetFormatToAuto:true,confirmBoundaryChange:true},'PATCH'),context(replacement.id))).status).toBe(409);
    const restored=await edit.POST(request({value:'example.test',expectedUpdatedAt:replacement.updatedAt,confirmReplacement:true}),context(replacement.id));expect(restored.status).toBe(201);expect((await restored.json()).asset.id).toBe(a.id);
    expect(await p.scopeAsset.findUniqueOrThrow({where:{id:a.id}})).toMatchObject({normalizedValue:'example.test',format:'DOMAIN',formatSource:'AUTO',active:true});
  });


});
