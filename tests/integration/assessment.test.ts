import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), publish: vi.fn(async () => ({ dispatch: 'PUBLISHED' })) }));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/server/queue/scanJobPublisher', () => ({ publishScanJob: mocks.publish, dispatchSelect: { status: true, attempts: true } }));
const db = process.env.TEST_DATABASE_URL, schema = 'assessment_' + randomUUID().replaceAll('-', '');
if (db) { const url = new URL(db); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.toString(); }
let p: typeof import('@/lib/prisma').prisma, sources: typeof import('@/app/api/programs/[id]/assessment-sources/route'), edit: typeof import('@/app/api/programs/[id]/assessment-sources/[sourceId]/route'), mode: typeof import('@/app/api/programs/[id]/assessment/route');
let userId: string, otherId: string, programId: string;
const context = (sourceId = '') => ({ params: Promise.resolve({ id: programId, sourceId }) });
const request = (body?: unknown, method = 'POST', origin = 'http://app.example.test') => new Request('http://app.example.test/api', { method, headers: { Origin: origin }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const sourceInput = { label: 'Backend', kind: 'GIT_REPOSITORY' as const, locator: 'https://internal.example.local/acme/backend', reference: 'main', includePaths: ['src/'], excludePaths: ['tests/'] };
async function createSource(label = 'Backend') { const response = await sources.POST(request({ ...sourceInput, label }), context()); expect(response.status).toBe(201); return (await response.json()).source; }
(db ? describe : describe.skip)('Assessment authorization PostgreSQL/API foundation', () => {
  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma: p } = await import('@/lib/prisma')); sources = await import('@/app/api/programs/[id]/assessment-sources/route'); edit = await import('@/app/api/programs/[id]/assessment-sources/[sourceId]/route'); mode = await import('@/app/api/programs/[id]/assessment/route');
    process.env.AUTH_URL = 'http://app.example.test';
  }, 30000);
  beforeEach(async () => {
    userId = (await p.user.create({ data: { email: randomUUID() + '@example.test' } })).id; otherId = (await p.user.create({ data: { email: randomUUID() + '@example.test' } })).id;
    programId = (await p.bountyProgram.create({ data: { ownerId: userId, companyName: 'Assessment fixture', requiredUserAgent: 'Fixture/1' } })).id;
    mocks.auth.mockResolvedValue({ user: { id: userId } });
  });
  afterAll(async () => { if (p) { await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await p.$disconnect(); } });
  it('defaults programs to Black-box and requires explicit mode-change confirmation', async () => {
    const before = await p.bountyProgram.findUniqueOrThrow({ where: { id: programId } }); expect(before.assessmentMode).toBe('BLACK_BOX');
    expect((await mode.PATCH(request({ assessmentMode: 'WHITE_BOX' }, 'PATCH'), context())).status).toBe(409);
    expect((await mode.PATCH(request({ assessmentMode: 'WHITE_BOX', confirmed: true }, 'PATCH'), context())).status).toBe(200);
    expect(await p.bountyProgram.findUniqueOrThrow({ where: { id: programId } })).toMatchObject({ assessmentMode: 'WHITE_BOX', updatedAt: before.updatedAt, scopeRules: before.scopeRules, outOfScope: before.outOfScope });
    expect((await mode.PATCH(request({ assessmentMode: 'BLACK_BOX', confirmed: true }, 'PATCH'), context())).status).toBe(200);
    expect((await p.bountyProgram.findUniqueOrThrow({ where: { id: programId } })).assessmentMode).toBe('BLACK_BOX');
  });
  it('creates, reads, edits, deactivates and reactivates metadata without opening a source', async () => {
    const source = await createSource(); expect(source.effective).toBe(false);
    await mode.PATCH(request({ assessmentMode: 'WHITE_BOX', confirmed: true }, 'PATCH'), context());
    expect((await (await sources.GET(request(undefined, 'GET'), context())).json()).sources[0]).toMatchObject({ id: source.id, effective: true, active: true });
    expect((await edit.PATCH(request({ label: 'Backend renamed', includePaths: ['packages\\api\\'] }, 'PATCH'), context(source.id))).status).toBe(200);
    expect((await edit.DELETE(request(undefined, 'DELETE'), context(source.id))).status).toBe(200);
    expect(await p.assessmentSource.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({ active: false, includePaths: ['packages/api/'] });
    expect((await edit.DELETE(request(undefined, 'DELETE'), context(source.id))).status).toBe(200);
    await edit.PATCH(request({ active: true }, 'PATCH'), context(source.id));
    await mode.PATCH(request({ assessmentMode: 'BLACK_BOX', confirmed: true }, 'PATCH'), context());
    expect((await (await sources.GET(request(undefined, 'GET'), context())).json()).sources[0]).toMatchObject({ active: true, effective: false });
    expect(await p.scopeAsset.count({ where: { programId } })).toBe(0); expect(await p.scanRun.count()).toBe(0);
  });
  it('rejects foreign ownership, origin, oversized metadata, credentials and traversal', async () => {
    const source = await createSource();
    for (const extra of [{ locator: 'https://user:pass@example.test/repo' }, { locator: 'https://example.test/repo?token=private' }, { includePaths: ['../../secret'] }, { reference: 'a..b' }, { notes: 'x'.repeat(2001) }]) expect((await sources.POST(request({ ...sourceInput, ...extra }), context())).status).toBe(400);
    const oversized = request({ notes: 'x'.repeat(140000) }); expect((await sources.POST(oversized, context())).status).toBe(413);
    expect((await sources.POST(request(sourceInput, 'POST', 'https://foreign.test'), context())).status).toBe(403);
    expect((await edit.DELETE(request(undefined, 'DELETE', 'https://foreign.test'), context(source.id))).status).toBe(403);
    mocks.auth.mockResolvedValue({ user: { id: otherId } });
    expect((await sources.GET(request(undefined, 'GET'), context())).status).toBe(404); expect((await edit.PATCH(request({ active: false }, 'PATCH'), context(source.id))).status).toBe(404); expect((await mode.PATCH(request({ assessmentMode: 'WHITE_BOX', confirmed: true }, 'PATCH'), context())).status).toBe(404);
    mocks.auth.mockResolvedValue(null); expect((await sources.GET(request(undefined, 'GET'), context())).status).toBe(401);
  });
  it('serializes source writes and mode snapshots using the same program lock', async () => {
    const source = await createSource(); await mode.PATCH(request({ assessmentMode: 'WHITE_BOX', confirmed: true }, 'PATCH'), context());
    const { captureProgramAssessment } = await import('@/server/assessment');
    let release!: () => void, entered!: () => void; const enteredLock = new Promise<void>(resolve => entered = resolve), released = new Promise<void>(resolve => release = resolve);
    const capture = p.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "BountyProgram" WHERE id=${programId} FOR SHARE`; const before = await captureProgramAssessment(tx, programId); entered(); await released; expect(await captureProgramAssessment(tx, programId)).toEqual(before); return before; });
    await enteredLock; let changed = false;
    const pending = edit.PATCH(request({ active: false }, 'PATCH'), context(source.id)).then(response => { changed = true; return response; });
    await new Promise(resolve => setTimeout(resolve, 30)); expect(changed).toBe(false); release();
    expect((await capture).authorizedSources).toHaveLength(1); expect((await pending).status).toBe(200);
  });
  it('captures parent/child metadata once; later changes affect only new runs', async () => {
    const { createScopeAsset } = await import('@/server/scopeAssets'), { startTargetRecon } = await import('@/server/recon/targetRuns');
    await createScopeAsset(userId, programId, { value: 'api.example.com', assetValue: 'MEDIUM' }); const a = await createSource('A'), b = await createSource('B');
    await mode.PATCH(request({ assessmentMode: 'WHITE_BOX', confirmed: true }, 'PATCH'), context());
    const parent = await startTargetRecon(userId, programId), before = await p.targetReconRun.findUniqueOrThrow({ where: { id: parent.id } });
    expect(before.assessmentModeSnapshot).toBe('WHITE_BOX'); expect((before.assessmentSourcesSnapshot as { id: string }[]).map(s => s.id).sort()).toEqual([a.id, b.id].sort());
    const child = await p.scanRun.findFirstOrThrow({ where: { targetReconRunId: parent.id } }); expect(child.assessmentModeSnapshot).toBe(before.assessmentModeSnapshot); expect(child.assessmentSourcesSnapshot).toEqual(before.assessmentSourcesSnapshot);
    await mode.PATCH(request({ assessmentMode: 'BLACK_BOX', confirmed: true }, 'PATCH'), context()); await edit.DELETE(request(undefined, 'DELETE'), context(a.id)); await createSource('C');
    expect((await p.targetReconRun.findUniqueOrThrow({ where: { id: parent.id } })).assessmentSourcesSnapshot).toEqual(before.assessmentSourcesSnapshot);
    expect((await p.scanRun.findUniqueOrThrow({ where: { id: child.id } })).assessmentSourcesSnapshot).toEqual(before.assessmentSourcesSnapshot);
    await p.scanRun.update({ where: { id: child.id }, data: { status: 'COMPLETED', outcome: 'SUCCESS' } }); await p.targetReconRun.update({ where: { id: parent.id }, data: { status: 'COMPLETED', outcome: 'SUCCESS' } });
    const next = await startTargetRecon(userId, programId); expect(next.assessmentModeSnapshot).toBe('BLACK_BOX'); expect(next.assessmentSourcesSnapshot).toEqual([]);
  });
  it('blocks deleting programs and cascades only their current source scopes', async () => {
    const source = await createSource(), other = await p.bountyProgram.create({ data: { ownerId: otherId, companyName: 'Other', requiredUserAgent: 'Fixture/1', assessmentSources: { create: { ...sourceInput, label: 'Other source' } } } });
    await p.bountyProgram.update({ where: { id: programId }, data: { deletingAt: new Date() } });
    expect((await sources.POST(request(sourceInput), context())).status).toBe(404); expect((await edit.DELETE(request(undefined, 'DELETE'), context(source.id))).status).toBe(404);
    await p.bountyProgram.delete({ where: { id: programId } }); expect(await p.assessmentSource.findUnique({ where: { id: source.id } })).toBeNull(); expect(await p.assessmentSource.count({ where: { programId: other.id } })).toBe(1);
  });
});
