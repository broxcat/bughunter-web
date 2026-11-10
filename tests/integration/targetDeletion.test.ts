import { execFileSync } from 'node:child_process';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
const auth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth }));
const db = process.env.TEST_DATABASE_URL;
const schema = 'target_delete_' + randomUUID().replaceAll('-', '');
describe.skipIf(!db)('Target cascade and external garbage collection', () => {
  let p: PrismaClient, ownerId: string, root: string;
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
    root = await mkdtemp(join(tmpdir(), 'target-delete-'));
    vi.stubEnv('RESEARCH_CONSOLE_ROOT', join(root, 'consoles'));
    vi.stubEnv('RESEARCH_WORKSPACE_ROOT', join(root, 'workspaces'));
    vi.stubEnv('RESEARCH_TERMINAL_CONTROL_URL', 'http://127.0.0.1:1');
    vi.stubEnv('RESEARCH_TERMINAL_PRIVATE_KEY_FILE', join(root, 'private.pem'));
    await writeFile(join(root, 'private.pem'), generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }, 60000);
  afterAll(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    if (p) { await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await p.$disconnect(); }
    if (root) await rm(root, { recursive: true, force: true });
  });
  async function fixture() {
    const program = await p.bountyProgram.create({ data: { ownerId, companyName: 'Cascade fixture', requiredUserAgent: 'Fixture/1',
      executionPolicies: { create: { version: 1, policy: { automationAllowed: true } } }, campaign: { create: {} } } });
    const scope = await p.scope.create({ data: { userId: ownerId, hostPattern: randomUUID() + '.example.test', status: 'APPROVED' } });
    const asset = await p.scopeAsset.create({ data: { programId: program.id, originalValue: scope.hostPattern, normalizedValue: scope.hostPattern, format: 'SUBDOMAIN', type: 'WEB_APPLICATION' } });
    const target = await p.target.create({ data: { programId: program.id, userId: ownerId, scopeId: scope.id, scopeAssetId: asset.id, host: scope.hostPattern } });
    const run = await p.scanRun.create({ data: { targetId: target.id, scopeAssetId: asset.id, type: 'RECON', status: 'RUNNING', startedAt: new Date() } });
    const workspaceId = 'research_' + target.id;
    const session = await p.researchSession.create({ data: { userId: ownerId, targetId: target.id, workspaceId, consoleTargetId: target.id, reconScanRunId: run.id, targetHost: target.host, programName: program.companyName, scopeMarkdown: 'fixture', status: 'READY' } });
    const finding = await p.finding.create({ data: { targetId: target.id, scanRunId: run.id, title: 'Promoted fixture', oobToken: randomUUID() } });
    const hypothesis = await p.researchHypothesis.create({ data: { sessionId: session.id, externalId: 'h1', title: 'Fixture', status: 'CONFIRMED', hypothesis: 'Fixture', evidenceFor: [], evidenceAgainst: [], nextTest: '', expectedSignal: '', falsificationCondition: '', contentSha256: 'a'.repeat(64) } });
    await p.researchFindingPromotion.create({ data: { userId: ownerId, findingId: finding.id, hypothesisId: hypothesis.id, hypothesisRevision: 1, snapshot: {} } });
    const report = await p.report.create({ data: { userId: ownerId, title: 'Exclusive fixture', targetId: target.id, items: { create: { findingId: finding.id } } } });
    await mkdir(join(root, 'consoles', workspaceId), { recursive: true });
    await writeFile(join(root, 'consoles', workspaceId, 'scope.md'), 'fixture');
    return { program, target, asset, run, session, finding, report, workspaceId };
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
    // Raw SQL leaves external/derived cleanup to the collector.
    expect(await p.report.findUnique({ where: { id: a.report.id } })).not.toBeNull();
    await access(join(root, 'consoles', a.workspaceId));
  });
  it('DELETE responds with the console stopped and a dead RUNNING worker, preserving a shared report', async () => {
    const a = await fixture(), b = await fixture();
    await p.scanExecutionAttempt.create({ data: { scanRunId: a.run.id, workerId: 'dead-worker', state: 'RUNNING' } });
    const shared = await p.report.create({ data: { userId: ownerId, title: 'Shared API', targetId: a.target.id, items: { create: [{ findingId: a.finding.id }, { findingId: b.finding.id }] } } });
    const { DELETE } = await import('@/app/api/programs/[id]/route');
    const start = Date.now();
    const result = await DELETE(new Request('http://app.example.test/api/programs/' + a.program.id, { method: 'DELETE' }), { params: Promise.resolve({ id: a.program.id }) });
    expect(result.status).toBe(200); expect(Date.now() - start).toBeLessThan(3000);
    expect(await p.report.findUnique({ where: { id: a.report.id } })).toBeNull();
    expect(await p.report.findUnique({ where: { id: shared.id }, include: { items: true } })).toMatchObject({ items: [{ findingId: b.finding.id }] });
    await remove(ownerId, a.program.id); // Idempotent retry.
  });
  it('deletes thousands of Recon observations within the HTTP budget', async () => {
    const a = await fixture();
    await p.reconSurfaceObservation.createMany({ data: Array.from({ length: 6000 }, (_, i) => ({ scanRunId: a.run.id, scopeAssetId: a.asset.id, contextKey: 'ANONYMOUS', contextType: 'ANONYMOUS', canonicalKey: 'GET:' + i, url: 'https://' + a.target.host + '/' + i, method: 'GET', responseClass: 'CONTENT', source: 'fixture' })) });
    const start = Date.now(); await remove(ownerId, a.program.id);
    expect(Date.now() - start).toBeLessThan(3000);
    expect(await p.reconSurfaceObservation.count({ where: { scanRunId: a.run.id } })).toBe(0);
  });
  it('finalizes deletingAt on the first collection, retries offline consoles, and collects orphan disk, reports, OOB and Redis jobs idempotently', async () => {
    const a = await fixture(), live = await fixture();
    await p.bountyProgram.update({ where: { id: a.program.id }, data: { deletingAt: new Date() } });
    const orphanHit = await p.oobHit.create({ data: { token: randomUUID(), method: 'GET' } });
    const liveHit = await p.oobHit.create({ data: { token: live.finding.oobToken!, method: 'GET' } });
    const orphanReport = await p.report.create({ data: { userId: ownerId, title: 'Orphan empty' } });
    const uuid = randomUUID(); await mkdir(join(root, 'workspaces', uuid), { recursive: true });
    await mkdir(join(root, 'workspaces', '.tmp-' + uuid + '-' + randomUUID()));
    await mkdir(join(root, 'workspaces', '.exports')); await writeFile(join(root, 'workspaces', '.exports', uuid + '.zip'), 'fixture');
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
      await expect(access(join(root, 'workspaces', uuid))).rejects.toThrow();
      await expect(access(join(root, 'workspaces', '.exports', uuid + '.zip'))).rejects.toThrow();
      await access(join(root, 'consoles', a.workspaceId)); // Retry identity retained while offline.
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(String(url).endsWith('/inventory') ? [] : { stopped: true })));
      await collect(); await collect();
      await expect(access(join(root, 'consoles', a.workspaceId))).rejects.toThrow();
      await access(join(root, 'consoles', live.workspaceId));
      if (queue) { expect(await queue.getJob(a.run.id)).toBeUndefined(); expect(await queue.getJob(live.run.id)).toBeDefined(); }
    } finally { vi.restoreAllMocks(); await queue?.close(); client?.disconnect(); }
  });
});
