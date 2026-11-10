import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
const auth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth }));
const db = process.env.TEST_DATABASE_URL;
const schema = 'target_delete_' + randomUUID().replaceAll('-', '');
describe.skipIf(!db)('Target cascade and external garbage collection', () => {
  let p: PrismaClient, ownerId: string;
  let remove: typeof import('@/server/programDeletion').deleteProgram;
  let collect: typeof import('@/server/resourceGarbageCollector').collectOrphanResources;
  beforeAll(async () => {
    const url = new URL(db!); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.href;
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma: p } = await import('@/lib/prisma'));
    ({ deleteProgram: remove } = await import('@/server/programDeletion'));
    ({ collectOrphanResources: collect } = await import('@/server/resourceGarbageCollector'));
    ownerId = (await p.user.create({ data: { email: randomUUID() + '@example.test' } })).id;
    auth.mockResolvedValue({ user: { id: ownerId } });
  }, 60000);
  afterAll(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    if (p) { await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await p.$disconnect(); }
  });
  async function fixture() {
    const program = await p.bountyProgram.create({ data: { ownerId, companyName: 'Cascade fixture', requiredUserAgent: 'Fixture/1',
      executionPolicies: { create: { version: 1, policy: { automationAllowed: true } } }, campaign: { create: {} } } });
    const scope = await p.scope.create({ data: { userId: ownerId, hostPattern: randomUUID() + '.example.test', status: 'APPROVED' } });
    const asset = await p.scopeAsset.create({ data: { programId: program.id, originalValue: scope.hostPattern, normalizedValue: scope.hostPattern, format: 'SUBDOMAIN', type: 'WEB_APPLICATION' } });
    const target = await p.target.create({ data: { programId: program.id, userId: ownerId, scopeId: scope.id, scopeAssetId: asset.id, host: scope.hostPattern } });
    const run = await p.scanRun.create({ data: { targetId: target.id, scopeAssetId: asset.id, type: 'RECON', status: 'RUNNING', startedAt: new Date() } });
    // Historical console session: Research history cascades with its Target.
    const session = await p.researchSession.create({ data: { userId: ownerId, targetId: target.id, workspaceId: 'research_' + target.id, consoleTargetId: target.id, reconScanRunId: run.id, targetHost: target.host, programName: program.companyName, scopeMarkdown: 'fixture', status: 'READY' } });
    const finding = await p.finding.create({ data: { targetId: target.id, scanRunId: run.id, title: 'Promoted fixture', oobToken: randomUUID() } });
    const hypothesis = await p.researchHypothesis.create({ data: { sessionId: session.id, externalId: 'h1', title: 'Fixture', status: 'CONFIRMED', hypothesis: 'Fixture', evidenceFor: [], evidenceAgainst: [], nextTest: '', expectedSignal: '', falsificationCondition: '', contentSha256: 'a'.repeat(64) } });
    await p.researchFindingPromotion.create({ data: { userId: ownerId, findingId: finding.id, hypothesisId: hypothesis.id, hypothesisRevision: 1, snapshot: {} } });
    const report = await p.report.create({ data: { userId: ownerId, title: 'Exclusive fixture', targetId: target.id, items: { create: { findingId: finding.id } } } });
    return { program, target, asset, run, session, finding, report };
  }
  it('deletes the complete graph in one SQL statement despite a tombstone; shared reports survive', async () => {
    const a = await fixture(), b = await fixture();
    const shared = await p.report.create({ data: { userId: ownerId, title: 'Shared', targetId: a.target.id, items: { create: [{ findingId: a.finding.id }, { findingId: b.finding.id }] } } });
    await p.bountyProgram.update({ where: { id: a.program.id }, data: { deletingAt: new Date() } });
    // Neither an ordinary update nor an FK-driven SET NULL may fire the guard.
    await p.target.update({ where: { id: a.target.id }, data: { label: 'Ordinary update' } });
    await p.$executeRaw`DELETE FROM "BountyProgram" WHERE id=${a.program.id}`;
    expect(await p.target.findUnique({ where: { id: a.target.id } })).toBeNull();
    expect(await p.researchSession.findUnique({ where: { id: a.session.id } })).toBeNull();
    expect(await p.researchFindingPromotion.count({ where: { findingId: a.finding.id } })).toBe(0);
    expect(await p.report.findUnique({ where: { id: shared.id }, include: { items: true } })).toMatchObject({ targetId: null, items: [{ findingId: b.finding.id }] });
    // Raw SQL leaves derived cleanup to the collector.
    expect(await p.report.findUnique({ where: { id: a.report.id } })).not.toBeNull();
  });
  it('DELETE answers 200 within 3 s despite a dead RUNNING worker, without network calls, preserving a shared report', async () => {
    const a = await fixture(), b = await fixture();
    await p.scanExecutionAttempt.create({ data: { scanRunId: a.run.id, workerId: 'dead-worker', state: 'RUNNING' } });
    const shared = await p.report.create({ data: { userId: ownerId, title: 'Shared API', targetId: a.target.id, items: { create: [{ findingId: a.finding.id }, { findingId: b.finding.id }] } } });
    const { DELETE } = await import('@/app/api/programs/[id]/route');
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network on the deletion path'));
    const start = Date.now();
    const result = await DELETE(new Request('http://app.example.test/api/programs/' + a.program.id, { method: 'DELETE' }), { params: Promise.resolve({ id: a.program.id }) });
    expect(result.status).toBe(200); expect(Date.now() - start).toBeLessThan(3000);
    expect(await p.report.findUnique({ where: { id: a.report.id } })).toBeNull();
    expect(await p.report.findUnique({ where: { id: shared.id }, include: { items: true } })).toMatchObject({ items: [{ findingId: b.finding.id }] });
    await remove(ownerId, a.program.id); // Idempotent retry.
    expect(network).not.toHaveBeenCalled(); network.mockRestore();
  });
  it('deletes thousands of Recon observations within the HTTP budget', async () => {
    const a = await fixture();
    await p.reconSurfaceObservation.createMany({ data: Array.from({ length: 6000 }, (_, i) => ({ scanRunId: a.run.id, scopeAssetId: a.asset.id, contextKey: 'ANONYMOUS', contextType: 'ANONYMOUS', canonicalKey: 'GET:' + i, url: 'https://' + a.target.host + '/' + i, method: 'GET', responseClass: 'CONTENT', source: 'fixture' })) });
    const start = Date.now(); await remove(ownerId, a.program.id);
    expect(Date.now() - start).toBeLessThan(3000);
    expect(await p.reconSurfaceObservation.count({ where: { scanRunId: a.run.id } })).toBe(0);
  });
  it('finalizes deletingAt on the first collection and collects orphan reports, OOB hits and Redis jobs idempotently without network calls', async () => {
    const a = await fixture(), live = await fixture();
    await p.bountyProgram.update({ where: { id: a.program.id }, data: { deletingAt: new Date() } });
    const orphanHit = await p.oobHit.create({ data: { token: randomUUID(), method: 'GET' } });
    const liveHit = await p.oobHit.create({ data: { token: live.finding.oobToken!, method: 'GET' } });
    const orphanReport = await p.report.create({ data: { userId: ownerId, title: 'Orphan empty' } });
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in the collector'));
    const redisUrl = process.env.TEST_EXECUTION_REDIS_URL;
    const client = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: null }) : undefined;
    const queue = client ? new Queue('scans', { connection: client }) : undefined;
    if (redisUrl) vi.stubEnv('REDIS_URL', redisUrl);
    if (queue) {
      await queue.add('scan', { scanRunId: a.run.id, targetId: a.target.id, type: 'RECON' }, { jobId: a.run.id });
      await queue.add('scan', { scanRunId: live.run.id, targetId: live.target.id, type: 'RECON' }, { jobId: live.run.id });
    }
    try {
      await collect();
      expect(await p.bountyProgram.findUnique({ where: { id: a.program.id } })).toBeNull();
      expect(await p.report.findUnique({ where: { id: orphanReport.id } })).toBeNull();
      expect(await p.oobHit.findUnique({ where: { id: orphanHit.id } })).toBeNull();
      expect(await p.oobHit.findUnique({ where: { id: liveHit.id } })).not.toBeNull();
      await collect(); await collect(); // Idempotent.
      expect(await p.bountyProgram.findUnique({ where: { id: live.program.id } })).not.toBeNull();
      expect(await p.researchSession.findUnique({ where: { id: live.session.id } })).not.toBeNull();
      expect(network).not.toHaveBeenCalled();
      if (queue) { expect(await queue.getJob(a.run.id)).toBeUndefined(); expect(await queue.getJob(live.run.id)).toBeDefined(); }
    } finally { vi.restoreAllMocks(); await queue?.close(); client?.disconnect(); }
  });
});
