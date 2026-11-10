// Actual native tools, worker, queue and disposable PostgreSQL/Redis.
// No public target or model inference. Passive engines run offline with a
// recorded fixture-only timeout, and a known local host is explicitly seeded.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordArtifact } from '@/server/recon/artifacts';
import { createScopeAsset } from '@/server/scopeAssets';
import { startTargetRecon, reconcileTargetRecon } from '@/server/recon/targetRuns';
import { buildSummaryInput } from '@/server/recon/summaries';
import { REPORT_PROMPT_VERSION } from '@/lib/reconReport';
import { RECON_BUDGETS, reconUrlAllowed, type ReconPlan } from '@/lib/reconPlanner';
import { createScanProcessor } from '@/server/queue/processScan';
import { SCAN_QUEUE_NAME, type ScanJobData } from '@/server/queue/scanQueue';
assert.equal(process.env.BH_DISPOSABLE_ASSET_TOOLS, '1');
assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/asset_test');
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }); connection.on('error', () => {});
const processor = createScanProcessor('methodology-native-fixture');
const worker = new Worker<ScanJobData>(SCAN_QUEUE_NAME, (job, token, signal) => processor.process(job, signal, token), { connection, concurrency: 2 }); worker.on('error', () => {});
const matrix = [
  { value: '*.recon.test', type: 'WILDCARD', assetValue: 'LOW' },
  { value: '*.recon.test', type: 'WILDCARD', assetValue: 'CRITICAL' },
  { value: 'recon.test', type: 'WEB_APPLICATION', assetValue: 'MEDIUM' },
  { value: 'recon.test', type: 'WEB_APPLICATION', assetValue: 'CRITICAL' },
  { value: 'fixture.recon.test', type: 'WEB_APPLICATION', assetValue: 'MEDIUM' },
  { value: 'api.recon.test', type: 'API', assetValue: 'HIGH' },
  { value: 'http://fixture.recon.test/api/', type: 'WEB_APPLICATION', assetValue: 'LOW' },
  { value: 'http://fixture.recon.test/api/', type: 'WEB_APPLICATION', assetValue: 'CRITICAL' },
  { value: 'http://api.recon.test/api/', type: 'API', assetValue: 'HIGH' },
] as const;
try {
  await worker.pause(true);
  const owner = await prisma.user.create({ data: { email: randomUUID() + '@example.test' } });
  const cases = [];
  for (const [index, input] of matrix.entries()) {
    // Separate explicit Targets avoid merging duplicate boundaries or overriding metadata.
    const program = await prisma.bountyProgram.create({ data: { ownerId: owner.id, companyName: 'Native methodology matrix ' + index, requiredUserAgent: 'Adaptive-Real/' + index } });
    const asset = await createScopeAsset(owner.id, program.id, input);
    const parent = await startTargetRecon(owner.id, program.id);
    const scan = await prisma.scanRun.findFirstOrThrow({ where: { targetReconRunId: parent.id, scopeAssetId: asset.id } });
    const plan = scan.reconPlan as unknown as ReconPlan;
    assert.equal(plan.methodologyVersion, 2); assert.equal(plan.assetValue, input.assetValue); assert.equal(plan.type, input.type);
    assert.equal(plan.depth, RECON_BUDGETS[input.assetValue].depth); assert.equal(plan.limits.rps, RECON_BUDGETS[input.assetValue].rps);
    assert.equal(plan.strategy, 'WIDE', 'A new Scope Asset starts with a broad inventory inside its own boundary');
    assert(plan.capabilities!.some(c => c.id === 'CONTENT_DISCOVERY'));
    assert(plan.capabilities!.find(c => c.id === 'NORMALIZATION')?.required);
    assert(!reconUrlAllowed(plan, 'http://outside.test/outside'));
    const productionLimits = structuredClone(plan.limits);
    if (asset.format === 'WILDCARD_DOMAIN') {
      // Exercise the real installed passive binaries without implying that an
      // internal Docker network can validate Internet enumeration completeness.
      plan.limits.passiveSeconds = 2;
      await prisma.scanRun.update({ where: { id: scan.id }, data: { reconPlan: plan as unknown as Prisma.InputJsonValue } });
      await prisma.targetReconRun.update({ where: { id: parent.id }, data: { preflight: { fixtureOnly: true, productionPassiveSeconds: productionLimits.passiveSeconds, actualPassiveSeconds: 2, knownHostSeed: 'fixture.recon.test', publicEnumerationTested: false } } });
      await recordArtifact(scan.id, asset, [], 'hostname', { hostname: 'fixture.recon.test' }, { tool: 'controlled-fixture', sourceRef: 'fixture:known-local-host-not-passive-discovery', observedAt: new Date().toISOString() });
    }
    cases.push({ asset, parent, scan, productionLimits });
  }
  await worker.resume();
  const end = Date.now() + 600000;
  let scans: Prisma.ScanRunGetPayload<{ include: { reconSteps: true; artifacts: true } }>[];
  for (;;) {
    scans = await prisma.scanRun.findMany({ where: { id: { in: cases.map(c => c.scan.id) } }, include: { reconSteps: true, artifacts: true } });
    if (scans.every(s => !['QUEUED', 'RUNNING'].includes(s.status))) break;
    if (Date.now() > end) throw new Error('Native matrix deadline exceeded: ' + JSON.stringify(scans.map(s => ({ id: s.id, status: s.status, error: s.error, steps: s.reconSteps }))));
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  for (const { asset, parent, scan: queued, productionLimits } of cases) {
    await reconcileTargetRecon(parent.id);
    const scan = scans.find(s => s.id === queued.id)!;
    assert(['SUCCESS', 'PARTIAL'].includes(scan.outcome!), JSON.stringify({ scan, fixture: asset.normalizedValue }));
    assert(scan.artifacts.length > 5, 'Discoveries must be normalized evidence, not a separate counter');
    assert.equal(scan.artifactVersion, 2);
    const artifactText = JSON.stringify(scan.artifacts);
    assert(!artifactText.includes('PRIVATE_COOKIE') && !artifactText.includes('PRIVATE_BODY'));
    assert(!artifactText.includes('__bughunter_'), 'Negative controls must not become discovered endpoint artifacts');
    const captured = scan.reconPlan as unknown as ReconPlan;
    const manifest = scan.toolManifest as unknown as { schemaVersion: number; fingerprint: string; tools: Record<string, { sha256: string; status: string }> };
    assert.equal(manifest.schemaVersion, 1); assert(manifest.fingerprint);
    for (const tool of ['subfinder', 'amass', 'assetfinder', 'httpx', 'nmap', 'ffuf', 'gobuster', 'nuclei']) { assert.equal(manifest.tools[tool].status, 'READY', tool + ' Doctor readiness'); assert.match(manifest.tools[tool].sha256, /^[a-f0-9]{64}$/); }
    const content = scan.reconSteps.find(s => s.name === 'Content discovery')!;
    const coverage = content.details as unknown as { capabilities: { capability: string; state: string; providersSelected: string[] }[] };
    assert(coverage.capabilities.some(c => c.capability === 'CONTENT_DISCOVERY'), 'Coverage must be persisted independently from logs');
    if(process.env.RECON_NATIVE_WILDCARD_REDIRECT==='true'){assert.equal(content.state,captured.depth==='LIGHT'?'COMPLETED_WITH_FALLBACK':'COMPLETED');assert(JSON.stringify(content.details).includes('WILDCARD_REDIRECT'));}
    const logs = await prisma.scanLog.findMany({ where: { scanRunId: scan.id }, select: { line: true } });
    assert(logs.some(l => l.line.startsWith('$ httpx ')), 'Real native HTTPX must execute');
    assert(logs.some(l => l.line.startsWith('$ ffuf ') || l.line.startsWith('$ gobuster dir ')), 'A real calibrated directory provider must execute');
    assert(logs.some(l => l.line.startsWith('$ nuclei ')), 'Native allowlisted Nuclei must execute');
    if(process.env.RECON_NATIVE_WILDCARD_REDIRECT==='true'){assert(!logs.some(l=>l.line.startsWith('$ gobuster dir ')));assert(logs.some(l=>l.line.startsWith('$ ffuf ')));}
    assert(!logs.some(l => /WARNING: sonic\/ast|fallback to encoding\/json/i.test(l.line)), 'Nuclei must use its compatible runtime');
    if (asset.format === 'URL') assert(scan.reconSteps.some(s => s.name === 'Ports / services' && s.state === 'SKIPPED_NOT_APPLICABLE'));
    else assert(logs.some(l => l.line.startsWith('$ nmap ')), 'Exact host bounded Nmap must execute');
    if (asset.format === 'WILDCARD_DOMAIN') {
      for (const tool of ['subfinder', 'amass', 'assetfinder']) assert(logs.some(l => l.line.startsWith('$ ' + tool + ' ')), 'Native offline passive provider attempted: ' + tool);
      const passive = scan.reconSteps.find(s => s.name === 'Passive discovery')!;
      assert.notEqual(passive.state, 'COMPLETED', 'Offline source failures are not successful passive discovery coverage');
      assert.equal(scan.outcome, 'PARTIAL');
    } else {
      assert.equal(scan.outcome, 'SUCCESS', 'Optional Burp unavailability cannot downgrade required completed coverage: ' + JSON.stringify(scan.reconSteps));
    }
    assert(scan.artifacts.some(a => a.scopeState === 'OUT_OF_SCOPE'), 'External references remain documentary');
    assert(scan.artifacts.some(a => a.kind === 'endpoint' && (a.value as { url?: string }).url?.includes('/api/courses')));
    const brief = await prisma.scanRun.findUniqueOrThrow({ where: { id: scan.id } });
    assert(brief.scopeMarkdown?.includes('format_version: 2') && brief.scopeMarkdown.includes('Normalized discoveries: ' + scan.artifacts.length));
    const graph = (brief.changeSet as { assetGraph?: { nodes: unknown[]; edges: unknown[]; authorizationGranted: boolean } })?.assetGraph;
    assert(graph && graph.nodes.length && graph.edges.length); assert.equal(graph.authorizationGranted, false);
    // Exercise real structured report preprocessing for every matrix case. This
    // does not impersonate model inference; real Settings/model acceptance is separate.
    const report = await buildSummaryInput(owner.id, asset.programId, asset.id);
    assert.equal(REPORT_PROMPT_VERSION, 'recon-report/2'); assert.equal(report.input.version, 2);
    assert.equal(report.input.assessment.format, asset.format); assert.equal(report.input.assessment.assetValue, asset.assetValue);
    assert(report.input.methodology.length && report.input.categories.length);
    const target = await prisma.targetReconRun.findUniqueOrThrow({ where: { id: parent.id } });
    assert(target.scopeMarkdown?.includes('Bug Bounty Target Intelligence'));
    console.log(JSON.stringify({ format: asset.format, type: asset.type, value: asset.assetValue, outcome: scan.outcome, discoveries: scan.artifacts.length, productionLimits, actualLimits: captured.limits, content: coverage.capabilities, reportInput: 'VALIDATED_NO_MODEL_INVOCATION' }));
  }
  const seen = await (await fetch('http://fixture.recon.test/__observations')).json() as { url: string; ua: string; method: string }[];
  assert(seen.length > 40); assert(seen.every(r => /^Adaptive-Real\/[0-8]$/.test(r.ua) && ['GET', 'HEAD'].includes(r.method)));
  assert(!seen.some(r => r.url.startsWith('/outside') || r.url.includes('/delete') || r.url.includes('logout')));
  assert.equal(await prisma.reconSummary.count(), 0, 'No configured model, summary provider or inference is fabricated');
  console.log('NATIVE_RECON_METHODOLOGY_MATRIX_PASSED: 9 Format/Type/Value cases; actual toolchain, captured limits, per-provider coverage, artifacts/graph, individual+Target scope.md, structured report preprocessing and Research snapshots. Offline wildcard passive failures remain Partial; optional Burp absence does not downgrade exact-host/URL coverage. No public scan or model invocation. Wildcard 307 fixture: '+String(process.env.RECON_NATIVE_WILDCARD_REDIRECT==='true')+'. ' + seen.length + ' local HTTP requests.');
} finally { processor.stopAccepting(); await processor.shutdown(); await worker.close(true); connection.disconnect(); await prisma.$disconnect(); }
process.exit(0);
