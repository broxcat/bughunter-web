// Actual worker, PostgreSQL, Redis, HTTP collector and installed broad-host tools.
// The only active target is the Docker-local fixture.recon.test service.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '@/lib/prisma';
import { createScopeAsset, ensureAssetExecution } from '@/server/scopeAssets';
import { createScanRequest } from '@/server/queue/scanRequest';
import { publishScanJob } from '@/server/queue/scanJobPublisher';
import { createScanProcessor } from '@/server/queue/processScan';
import { SCAN_QUEUE_NAME, type ScanJobData } from '@/server/queue/scanQueue';
assert.equal(process.env.BH_DISPOSABLE_ASSET_TOOLS, '1'); assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/asset_test');
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }), processor = createScanProcessor('asset-real-fixture');
connection.on('error', () => {});
const worker = new Worker<ScanJobData>(SCAN_QUEUE_NAME, (job, token, signal) => processor.process(job, signal, token), { connection, concurrency: 1 }); worker.on('error', () => {});
try {
  const owner = await prisma.user.create({ data: { email: randomUUID() + '@example.test' } });
  const program = await prisma.bountyProgram.create({ data: { ownerId: owner.id, companyName: 'Local asset collection fixture', requiredUserAgent: 'Asset-Real/1' } });
  for (const input of [{ value: 'http://fixture.recon.test/api/', type: 'API' as const }, { value: 'fixture.recon.test', type: 'WEB_APPLICATION' as const }]) {
    const asset = await createScopeAsset(owner.id, program.id, { ...input, assetValue: 'HIGH' });
    const { target } = await ensureAssetExecution(owner.id, program.id, asset.id);
    const run = await createScanRequest(owner.id, { targetId: target.id, type: 'RECON', scopeAssetId: asset.id }, null);
    assert.equal((await publishScanJob(run.id)).dispatch, 'PUBLISHED');
    const end = Date.now() + 180000;
    let result;
    for (;;) {
      result = await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id }, include: { reconSteps: true } });
      if (!['QUEUED', 'RUNNING'].includes(result.status)) break;
      if (Date.now() > end) throw new Error('Local asset execution deadline exceeded'); await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(result.assetResults, JSON.stringify({ outcome: result.outcome, stages: result.reconSteps }));
    assert(['SUCCESS', 'PARTIAL'].includes(result.outcome!));
    const saved = result.assetResults as { hosts: { http: { statusCode: number; authenticationSchemes: string[] }[]; corpus: { urls: string[]; technologies: string[] } }[] };
    assert(saved.hosts[0].http.some(h => h.statusCode === 200)); assert(saved.hosts[0].corpus.urls.length > 0);
    assert(!JSON.stringify(saved).includes('PRIVATE_COOKIE') && !JSON.stringify(saved).includes('PRIVATE_BODY'));
    const seen = await (await fetch('http://fixture.recon.test/__observations?reset=1')).json() as { url: string; ua: string }[];
    assert(seen.length > 1); assert(seen.every(r => r.ua === 'Asset-Real/1'));
    if (input.type === 'API') {
      assert(seen.every(r => r.url.startsWith('/api/')), JSON.stringify(seen));
      assert(result.reconSteps.some(s => s.name === 'Ports' && s.state === 'SKIPPED'));
      assert(saved.hosts[0].http.some(h => h.statusCode === 401 && h.authenticationSchemes.includes('bearer')));
    } else {
      const logs = await prisma.scanLog.findMany({ where: { scanRunId: run.id }, select: { line: true } });
      for (const tool of ['httpx', 'nmap', 'katana']) assert(logs.some(l => l.line.startsWith('$ ' + tool + ' ')), tool);
      assert(logs.some(l => l.line.includes('-p 80,443,8080,8443')));
    }
    console.log(`${input.type}: actual worker/queue, ${seen.length} fixture HTTP requests, exact User-Agent, observed metadata and explicit ${result.outcome} coverage passed.`);
  }
} finally { processor.stopAccepting(); await processor.shutdown(); await worker.close(true); connection.disconnect(); await prisma.$disconnect(); }
process.exit(0); // The publisher owns an additional Redis connection; this isolated process is finished.
