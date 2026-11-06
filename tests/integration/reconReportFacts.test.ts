import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const database = process.env.TEST_DATABASE_URL;
const schema = 'report_' + randomUUID().replaceAll('-', '');
if (database) { const url = new URL(database); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.toString(); }
let prisma: typeof import('@/lib/prisma').prisma;
let load: typeof import('@/server/recon/reportFacts').loadReconReportFacts;
let detail: typeof import('@/server/recon/runDetail').loadTargetReconRun;
(database ? describe : describe.skip)('Recon report evidence (actual SQL, synthetic fixtures)', () => {
  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma } = await import('@/lib/prisma'));
    ({ loadReconReportFacts: load } = await import('@/server/recon/reportFacts'));
    ({ loadTargetReconRun: detail } = await import('@/server/recon/runDetail'));
  }, 120000);
  afterAll(async () => { if (prisma) { await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await prisma.$disconnect(); } });
  it('retains captured identity, mode and UA after edits; independently bounds hosts; denies other owners', async () => {
    const owner = await prisma.user.create({ data: { email: randomUUID() + '@example.test' } });
    const program = await prisma.bountyProgram.create({ data: { ownerId: owner.id, companyName: 'Report fixture', requiredUserAgent: 'Current-UA', outOfScope: ['current-exclusion.test'] } });
    const parent = await prisma.targetReconRun.create({ data: { programId: program.id, assessmentModeSnapshot: 'WHITE_BOX', status: 'COMPLETED', outcome: 'PARTIAL' } });
    for (const [index, host] of ['first.test', 'second.test'].entries()) {
      const scope = await prisma.scope.create({ data: { userId: owner.id, hostPattern: host, status: 'APPROVED' } });
      const asset = await prisma.scopeAsset.create({ data: { programId: program.id, originalValue: host, normalizedValue: host, format: 'DOMAIN', type: 'WEB_APPLICATION' } });
      const target = await prisma.target.create({ data: { userId: owner.id, programId: program.id, scopeId: scope.id, scopeAssetId: asset.id, host } });
      const scan = await prisma.scanRun.create({ data: { targetId: target.id, scopeAssetId: asset.id, targetReconRunId: parent.id, reconOrder: index, type: 'RECON', requiredUserAgent: 'Captured-UA', scopeAssetSnapshot: { normalizedValue: host }, reconPlan: { authorization: { exclusions: ['captured-exclusion.test'] } } } });
      await prisma.reconArtifact.createMany({ data: Array.from({ length: index === 0 ? 805 : 2 }, (_, i) => ({ scanRunId: scan.id, scopeAssetId: asset.id, kind: 'endpoint', canonicalKey: `${host}/${String(i).padStart(4, '0')}`, value: { url: `https://${host}/${i}`, statusCode: 200 }, scopeState: 'IN_SCOPE', verification: 'OBSERVED', sources: [], firstSeenAt: new Date(), lastSeenAt: new Date() })) });
      await prisma.scopeAsset.update({ where: { id: asset.id }, data: { normalizedValue: 'edited-' + host, active: false } });
    }
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Network forbidden'));
    try {
      const facts = await load(owner.id, parent.id);
      expect(facts.authorizedAssets).toEqual(['first.test', 'second.test']);
      expect(facts.program).toMatchObject({ assessmentMode: 'WHITE_BOX', requiredUserAgent: 'Captured-UA', outOfScope: ['captured-exclusion.test'], rulesOfEngagement: null });
      expect(facts.scans.map(scan => scan.artifacts.length)).toEqual([400, 2]);
      expect(facts.scans[0].artifactCount).toBe(805);
      expect((await detail(owner.id, parent.id)).run.scans.map(scan => scan.capturedHost)).toEqual(['first.test', 'second.test']);
      await expect(load('another-owner', parent.id)).rejects.toMatchObject({ status: 404 });
      await expect(detail('another-owner', parent.id)).rejects.toMatchObject({ status: 404 });
      await expect(load(owner.id, 'missing')).rejects.toMatchObject({ status: 404 });
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
});
