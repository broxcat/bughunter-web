import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
const db = process.env.TEST_DATABASE_URL, schema = 'recon_nav_' + randomUUID().replaceAll('-', '');
if (db) { const u = new URL(db); u.searchParams.set('schema', schema); process.env.DATABASE_URL = u.toString(); }
let p: typeof import('@/lib/prisma').prisma, service: typeof import('@/server/recon/runHistory'), route: typeof import('@/app/api/programs/[id]/recon/route');
let ownerId: string, programId: string;
(db ? describe : describe.skip)('Read-only Recon history and exact-run heartbeat (real SQL)', () => {
  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma: p } = await import('@/lib/prisma')); service = await import('@/server/recon/runHistory'); route = await import('@/app/api/programs/[id]/recon/route');
  }, 120000);
  beforeEach(async () => {
    ownerId = (await p.user.create({ data: { email: randomUUID() + '@example.test' } })).id;
    programId = (await p.bountyProgram.create({ data: { ownerId, companyName: 'Recon navigation', requiredUserAgent: 'Fixture/1' } })).id;
    mocks.auth.mockResolvedValue({ user: { id: ownerId } });
  });
  afterAll(async () => { if (p) { await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await p.$disconnect(); } });
  const seed = async (count: number) => {
    const ids = Array.from({ length: count }, (_, n) => programId + '_' + String(n).padStart(3, '0'));
    await p.targetReconRun.createMany({ data: ids.map(id => ({ id, programId, createdAt: new Date('2026-01-01'), status: 'COMPLETED', outcome: null })) });
    return ids.reverse();
  };
  const history = (page = 1, pageSize = 25) => service.reconRunHistory(ownerId, programId, { page, pageSize, q: '' });
  const heartbeat = (runId: string, id = programId) => route.GET(new Request(`http://app.example.test/api/programs/${id}/recon?runId=${encodeURIComponent(runId)}`), { params: Promise.resolve({ id }) });
  it.each([0, 1, 25, 26, 51, 101])('exposes every retained row over %i tied dates with bounded stable pages', async count => {
    const ids = await seed(count), collected: string[] = [];
    for (let page = 1; page <= Math.max(1, Math.ceil(count / 25)); page++) {
      const data = await history(page); collected.push(...data.items.map(r => r.id));
      expect(data).toMatchObject({ page, total: count, pages: Math.max(1, Math.ceil(count / 25)), pageSize: 25 });
      expect(data.items.length).toBeLessThanOrEqual(25);
    }
    expect(collected).toEqual(ids);
    expect((await history(999)).page).toBe(Math.max(1, Math.ceil(count / 25)));
    expect((await history(1, 100)).items).toHaveLength(Math.min(100, count));
  });
  it('recovers a removed final row and handles insertion/removal between page requests', async () => {
    const ids = await seed(26);
    expect((await history(2)).items[0].id).toBe(ids[25]);
    await p.targetReconRun.delete({ where: { id: ids[25] } });
    expect(await history(2)).toMatchObject({ page: 1, pages: 1, total: 25 });
    const inserted = await p.targetReconRun.create({ data: { programId } });
    expect((await history()).items[0].id).toBe(inserted.id);
    expect((await history(2)).items).toHaveLength(1);
  });
  it('denies missing/private Target history and exact-run cross-Target/cross-owner access', async () => {
    const [id] = await seed(1);
    await expect(service.reconRunHistory('another-owner', programId, { page: 1, pageSize: 25, q: '' })).rejects.toMatchObject({ status: 404 });
    await expect(service.reconRunHistory(ownerId, 'missing', { page: 1, pageSize: 25, q: '' })).rejects.toMatchObject({ status: 404 });
    expect((await heartbeat('missing')).status).toBe(404);
    expect((await heartbeat(id, 'wrong-program')).status).toBe(404);
    mocks.auth.mockResolvedValue({ user: { id: 'another-owner' } }); expect((await heartbeat(id)).status).toBe(404);
    mocks.auth.mockResolvedValue(null); expect((await heartbeat(id)).status).toBe(401);
  });
  it.each(['COMPLETED', 'FAILED', 'CANCELLED'] as const)('reads exact run transitions to %s without substituting a newer run', async status => {
    const [id] = await seed(1);
    await p.targetReconRun.update({ where: { id }, data: { status: 'RUNNING' } });
    await p.targetReconRun.create({ data: { programId, status: 'COMPLETED', outcome: 'SUCCESS' } });
    expect(await (await heartbeat(id)).json()).toEqual({ id, status: 'RUNNING' });
    await p.targetReconRun.update({ where: { id }, data: { status } });
    const response = await heartbeat(id); expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(await response.json()).toEqual({ id, status });
  });
  it('keeps retired/missing historical policy readable and performs no authorization, queue or Scope writes', async () => {
    const [id] = await seed(1);
    await p.bountyProgram.update({ where: { id: programId }, data: { deletingAt: new Date() } });
    const before = await p.bountyProgram.findUniqueOrThrow({ where: { id: programId } });
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No target traffic'));
    try {
      expect((await history()).items[0]).toMatchObject({ id, outcome: null, _count: { scans: 0 } });
      expect((await heartbeat(id)).status).toBe(200);
      expect(await p.bountyProgram.findUniqueOrThrow({ where: { id: programId } })).toEqual(before);
      expect(await p.scopeAsset.count()).toBe(0); expect(await p.scanRun.count()).toBe(0); expect(await p.scanJobOutbox.count()).toBe(0); expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
});
