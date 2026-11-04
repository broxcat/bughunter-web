// Real model + exact historical Recon evidence, exclusively in a disposable DB.
// No scanner/worker runs here. No prompt, model body or evidence is logged.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { chown, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright-chromium';
import { Prisma, type ReconArtifact, type ReconSummary, type ScanRun, type ScopeAsset, type ReconPipelineStep } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { scheduleReconSummary, processReconSummary } from '@/server/recon/summaries';
import { classifyReconUrl } from '@/lib/reconArtifacts';
import { modelInputForReconReportV3, type ReconReportV3Input } from '@/lib/reconReportV3';

type Json = Record<string, unknown>;
type Serialized<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };
type Source = { config: { model: string; baseUrl: string }; scan: Serialized<ScanRun> & { target: { userId: string; programId: string }; scopeAsset: Serialized<ScopeAsset>; reconSteps: Serialized<ReconPipelineStep>[] }; job: Serialized<ReconSummary>; artifacts: Serialized<ReconArtifact>[] };
type Saved = { sourceSha256: string; asset: Serialized<ReconSummary>; target: Serialized<ReconSummary> };
const json = (v: unknown) => v as Prisma.InputJsonValue;
const nullableJson = (v: unknown) => v === null || v === undefined ? Prisma.DbNull : json(v);
const date = (v: string | null | undefined) => v ? new Date(v) : null;
const asObject = (v: unknown): Json => v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {};
const serial = <T,>(v: T): Serialized<T> => JSON.parse(JSON.stringify(v)) as Serialized<T>;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const citedRefs = (v: unknown): string[] => Array.isArray(v) ? v.flatMap(citedRefs) : v && typeof v === 'object' ? Object.entries(v).flatMap(([key, item]) => key === 'evidenceRefs' && Array.isArray(item) ? item.filter((ref): ref is string => typeof ref === 'string') : citedRefs(item)) : [];
const metadata = (phase: string, extra: Json = {}) => console.log(JSON.stringify({ acceptance: 'recon-report-v3', phase, ...extra }));
async function savePrivate(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  const uid = Number(process.env.RECON_REPORT_V3_OUTPUT_UID), gid = Number(process.env.RECON_REPORT_V3_OUTPUT_GID);
  // The image runs as root; the host must retain access to its private export
  // after this disposable container is removed. Keep mode0600 throughout.
  if (process.getuid?.() === 0 && Number.isSafeInteger(uid) && uid >= 0 && Number.isSafeInteger(gid) && gid >= 0) await chown(path, uid, gid);
}
let phase = 'preflight', browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, web: ReturnType<typeof spawn> | undefined;

async function main() {
  assert.equal(process.env.BH_DISPOSABLE_REPORT_V3, '1', 'Disposable acceptance marker required');
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/report_v3_real_test', 'Disposable database required');
  const raw = await readFile(process.env.RECON_REPORT_V3_SOURCE_FILE!, 'utf8'), source = JSON.parse(raw) as Source;
  const sourceSha256 = createHash('sha256').update(raw).digest('hex');
  const scan = source.scan, asset = scan.scopeAsset, ownerId = scan.target.userId, programId = scan.target.programId;
  assert(scan.id && asset.id && ownerId && programId && source.artifacts.length, 'Incomplete exported Recon');
  assert(source.config.model && source.config.baseUrl, 'Selected Settings missing');
  assert.equal(await prisma.user.count(), 0, 'Acceptance database must be empty');

  const provider = new URL(source.config.baseUrl), allowedOrigins = new Set([provider.origin]);
  const originalFetch = globalThis.fetch;
  let providerRequests = 0;
  globalThis.fetch = async (input, init) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    assert(allowedOrigins.has(u.origin), 'Report attempted an unapproved network origin');
    if (u.origin === provider.origin) providerRequests++;
    return originalFetch(input, { ...init, redirect: 'error' });
  };
  try {
    phase = 'clone';
    const password = randomUUID(), email = randomUUID() + '@example.test';
    await prisma.user.create({ data: { id: ownerId, email, passwordHash: await bcrypt.hash(password, 10) } });
    const originalMetadata = asObject(asObject(source.job.input).metadata);
    await prisma.bountyProgram.create({ data: { id: programId, ownerId, companyName: typeof originalMetadata.target === 'string' ? originalMetadata.target : 'Copied Recon acceptance', requiredUserAgent: scan.requiredUserAgent ?? 'Report-Acceptance/3', scopeRules: [asset.normalizedValue], outOfScope: Array.isArray(originalMetadata.exclusions) ? originalMetadata.exclusions.filter((x): x is string => typeof x === 'string') : [], rulesOfEngagement: typeof originalMetadata.rulesOfEngagement === 'string' ? originalMetadata.rulesOfEngagement : null } });
    await prisma.scopeAsset.create({ data: { ...asset, createdAt: new Date(asset.createdAt), updatedAt: new Date(asset.updatedAt) } });
    const url = new URL(/^https?:\/\//i.test(asset.normalizedValue) ? asset.normalizedValue : 'https://' + asset.normalizedValue.replace(/^\*\./, ''));
    const scope = await prisma.scope.create({ data: { userId: ownerId, hostPattern: asset.normalizedValue, status: 'APPROVED' } });
    await prisma.target.create({ data: { id: scan.targetId, userId: ownerId, programId, scopeId: scope.id, scopeAssetId: asset.id, host: url.host, scheme: url.protocol.slice(0, -1), active: false } });
    const parentId = scan.targetReconRunId ?? 'acceptance-' + randomUUID();
    await prisma.targetReconRun.create({ data: { id: parentId, programId, status: scan.status, outcome: scan.outcome, createdAt: new Date(scan.createdAt), startedAt: date(scan.startedAt), finishedAt: date(scan.finishedAt) } });
    const { target: _target, scopeAsset: _asset, reconSteps, ...scanData } = scan;
    void _target; void _asset;
    await prisma.scanRun.create({ data: { ...scanData, targetReconRunId: parentId, createdAt: new Date(scan.createdAt), startedAt: date(scan.startedAt), finishedAt: date(scan.finishedAt), cancelRequestedAt: date(scan.cancelRequestedAt), ...Object.fromEntries(['reconPlan','toolVersions','toolManifest','changeSet','scopeAssetSnapshot','assetResults','huntReport','reconCorpus','huntSnapshot'].map(key => [key, nullableJson(scanData[key as keyof typeof scanData])])) } as Prisma.ScanRunUncheckedCreateInput });
    await prisma.reconPipelineStep.createMany({ data: reconSteps.map(row => ({ ...row, details: nullableJson(row.details), startedAt: date(row.startedAt), finishedAt: date(row.finishedAt) })) });
    await prisma.reconArtifact.createMany({ data: source.artifacts.map(row => ({ ...row, value: json(row.value), sources: json(row.sources), firstSeenAt: new Date(row.firstSeenAt), lastSeenAt: new Date(row.lastSeenAt) })) });
    await prisma.aiProviderConfig.create({ data: { userId: ownerId, provider: 'OLLAMA', baseUrl: source.config.baseUrl, model: source.config.model, isActive: true } });
    const historical = await prisma.reconSummary.create({ data: { ...source.job, input: json(source.job.input), content: nullableJson(source.job.content), createdAt: new Date(source.job.createdAt), startedAt: date(source.job.startedAt), generatedAt: date(source.job.generatedAt) } });
    const historicalHash = digest(serial(historical));
    const evidenceBefore = digest(await prisma.reconArtifact.findMany({ orderBy: { id: 'asc' } }));
    const scanBefore = digest(await prisma.scanRun.findUniqueOrThrow({ where: { id: scan.id } }));

    const replayFile = process.env.RECON_REPORT_V3_REPLAY_FILE;
    let assetReport: ReconSummary, targetReport: ReconSummary;
    if (replayFile) {
      phase = 'replay';
      const saved = JSON.parse(await readFile(replayFile, 'utf8')) as Saved;
      assert.equal(saved.sourceSha256, sourceSha256, 'Saved reports belong to another Recon export');
      const restore = (row: Serialized<ReconSummary>) => prisma.reconSummary.create({ data: { ...row, automaticKey: null, input: json(row.input), content: nullableJson(row.content), createdAt: new Date(row.createdAt), startedAt: date(row.startedAt), generatedAt: date(row.generatedAt) } });
      assetReport = await restore(saved.asset); targetReport = await restore(saved.target);
      metadata('replay', { status: 'PASS', realModelGenerationPreviouslySaved: true });
    } else {
      const generate = async (assetId?: string) => {
        phase = assetId ? 'asset-generation' : 'target-generation';
        const started = Date.now(), job = await scheduleReconSummary(ownerId, programId, assetId, true);
        assert.equal(job.promptVersion, 'recon-report/3', 'New reports must use prompt v3');
        assert.equal(job.model, source.config.model); assert.equal(job.endpoint.replace(/\/+$/, ''), source.config.baseUrl.replace(/\/+$/, ''));
        assert.equal(asObject(job.input).version, 3);
        await processReconSummary(job.id);
        const saved = await prisma.reconSummary.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(saved.status, 'READY', 'Real report did not become READY');
        const report = asObject(saved.content), input = asObject(saved.input);
        const generation = asObject(report.generation), budget = asObject(input.budget);
        const warningPaths = (Array.isArray(report.warnings) ? report.warnings : []).map(item => ({ code: asObject(item).code, path: asObject(item).path })).filter(item => typeof item.code === 'string' && /^[A-Z_]+$/.test(item.code) && typeof item.path === 'string' && /^[A-Za-z0-9_.[\]]{1,160}$/.test(item.path));
        metadata(phase + '-result', { status: saved.status, model: saved.model, promptVersion: saved.promptVersion, narrativeStatus: report.narrativeStatus, narrativeFailure: report.narrativeFailure ?? null, warningPaths, attempts: (Array.isArray(generation.attempts) ? generation.attempts : []).map(item => ({ attempt: asObject(item).attempt, status: asObject(item).status })), latencyMs: Date.now() - started, generationMs: generation.durationMs, contextTokens: budget.contextTokens, maxInputBytes: budget.maxInputBytes, outputTokens: budget.outputTokens, modelInputBytes: Buffer.byteLength(JSON.stringify(modelInputForReconReportV3(saved.input as unknown as ReconReportV3Input))) });
        if (report.narrativeStatus === 'FACTUAL_ONLY' && process.env.RECON_REPORT_V3_OUTPUT_FILE) await savePrivate(process.env.RECON_REPORT_V3_OUTPUT_FILE + '.failed.json', { sourceSha256, phase, report: serial(saved) });
        assert.equal(report.version, 3); assert.deepEqual(report.factual, input.factual, 'Model changed server-owned facts');
        const ledger = Array.isArray(input.fullEvidenceLedger) ? input.fullEvidenceLedger : [];
        const knownIds = new Set(ledger.map(row => asObject(row).id));
        assert(knownIds.size > 0, 'Factual evidence ledger missing');
        const references = citedRefs(report.narrative);
        assert(references.length > 0, 'Real model supplied no cited interpretation');
        for (const id of references) assert(knownIds.has(id), 'Stored model citation is not a real retained evidence reference');
        for (const artifact of source.artifacts) {
          const url = asObject(artifact.value).url;
          let isStatic = false;
          if (typeof url === 'string') try { isStatic = classifyReconUrl(url) === 'static'; } catch { /* Malformed source remains documentary. */ }
          assert(isStatic || knownIds.has(artifact.id), 'Non-static source evidence disappeared from the factual ledger');
        }
        assert(['VALID','RECOVERED'].includes(String(report.narrativeStatus)), 'Factual-only fallback is not real-model acceptance');
        assert(JSON.stringify(report.narrative).length > 100, 'Real model narrative missing');
        metadata(phase, { status: 'PASS', model: saved.model, promptVersion: saved.promptVersion, latencyMs: Date.now() - started, narrativeStatus: report.narrativeStatus, warningCount: Array.isArray(report.warnings) ? report.warnings.length : 0, citationCount: references.length, artifacts: source.artifacts.length, storedSnapshotBytes: Buffer.byteLength(JSON.stringify(input)) });
        return saved;
      };
      assetReport = await generate(asset.id); targetReport = await generate();
      assert(providerRequests > 0, 'No request reached the configured real Ollama server');
      if (process.env.RECON_REPORT_V3_OUTPUT_FILE) await savePrivate(process.env.RECON_REPORT_V3_OUTPUT_FILE, { sourceSha256, asset: serial(assetReport), target: serial(targetReport) });
    }

    phase = 'source-preservation';
    assert.equal(digest(serial(await prisma.reconSummary.findUniqueOrThrow({ where: { id: historical.id } }))), historicalHash, 'Historical v2 summary mutated');
    assert.equal(digest(await prisma.reconArtifact.findMany({ orderBy: { id: 'asc' } })), evidenceBefore, 'Original evidence mutated');
    assert.equal(digest(await prisma.scanRun.findUniqueOrThrow({ where: { id: scan.id } })), scanBefore, 'Original Recon mutated');
    assert.equal(await prisma.scanExecutionAttempt.count(), 0, 'Reports must never start scanners');
    assert.equal(await prisma.scanJobOutbox.count(), 0, 'Reports must never queue scanners');
    metadata(phase, { status: 'PASS', historicalSummaryUnchanged: true, originalReconUnchanged: true, scannerAttempts: 0, queuedScannerJobs: 0 });

    if (process.env.RECON_REPORT_V3_BROWSER === 'true') {
      phase = 'browser';
      const socket = createServer(); await new Promise<void>(r => socket.listen(0, '127.0.0.1', r));
      const port = (socket.address() as { port: number }).port; await new Promise<void>(r => socket.close(() => r()));
      const origin = `http://127.0.0.1:${port}`; allowedOrigins.add(origin);
      web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: process.cwd(), env: { ...process.env, AUTH_URL: origin, AUTH_SECRET: randomUUID(), ALLOW_PUBLIC_REGISTRATION: 'false', TRUST_PROXY_HEADERS: 'false' }, stdio: 'ignore' });
      for (let n = 0;; n++) {
        assert(web.exitCode === null, 'Isolated web stopped');
        try { if ((await fetch(origin + '/api/health')).ok) break; } catch { /* Readiness only. */ }
        assert(n < 150, 'Isolated web readiness timeout'); await new Promise(r => setTimeout(r, 100));
      }
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const context = await browser.newContext();
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage(), pageErrors: string[] = [];
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await page.goto(origin + '/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL(origin + '/targets');
      for (const [path, api, saved] of [
        ['/scopes/' + asset.id, `/api/programs/${programId}/assets/${asset.id}/summary`, assetReport],
        ['/targets/' + programId, `/api/programs/${programId}/summary`, targetReport],
      ] as const) {
        await page.goto(origin + path);
        const response = await context.request.get(origin + api); assert.equal(response.status(), 200);
        const returned = await response.json() as { summary?: { id: string; content: unknown } };
        assert.equal(returned.summary?.id, saved.id); assert.deepEqual(returned.summary?.content, saved.content, 'Browser API changed the saved report');
        await page.getByRole('button', { name: 'Summary', exact: true }).click();
        const dialog = page.getByRole('dialog'); await dialog.waitFor();
        await dialog.getByRole('heading', { name: 'Recon facts', exact: true }).waitFor();
        const factsRegion = dialog.getByRole('region', { name: 'Recon facts', exact: true });
        const narrativeRegion = dialog.getByRole('region', { name: 'Ollama synthesis', exact: true });
        assert.equal(await dialog.locator('pre').count(), 0, 'Raw JSON displayed');
        const text = await dialog.innerText(), report = asObject(saved.content);
        assert(text.includes('recon-report/3'), 'Historical renderer used instead of v3');
        assert(text.includes(scan.id) || saved.scopeAssetId === null, 'Source Recon reference missing');
        const factual = asObject(report.factual), narrative = asObject(report.narrative);
        assert(JSON.stringify(factual).length > 100 && JSON.stringify(narrative).length > 100);
        // Facts stay compact until requested. Inspect real rendered values,
        // rather than treating an unchanged modal heading as acceptance.
        for (const details of await factsRegion.locator(':scope > details').all()) await details.locator('summary').first().click();
        const normalize = (v: string) => v.replace(/\s+/g, ' ').trim();
        const renderedFacts = normalize(await factsRegion.innerText());
        let checkedRows = 0;
        for (const section of (Array.isArray(factual.sections) ? factual.sections : [])) {
          const rows = asObject(section).rows;
          for (const row of (Array.isArray(rows) ? rows : []).slice(0, 2)) {
            const value = asObject(row).value;
            if (typeof value === 'string' && value.trim()) {
              assert(renderedFacts.includes(normalize(value)), 'A stored factual value is missing from the rendered report'); checkedRows++;
            }
          }
        }
        assert(checkedRows > 0, 'No factual rows were visually checked');
        assert(typeof narrative.attackSurfaceSummary === 'string' && narrative.attackSurfaceSummary.trim(), 'Narrative summary missing');
        assert(normalize(await narrativeRegion.innerText()).includes(normalize(narrative.attackSurfaceSummary)), 'Stored model narrative missing from the rendered report');
        await page.getByRole('button', { name: 'Close', exact: true }).click();
      }
      assert.deepEqual(pageErrors, [], 'Browser reported application errors');
      metadata('browser', { status: 'PASS', exactStoredAssetAndTargetReports: true, rawJsonDisplayed: false, externalBrowserRequestsAllowed: false });
    } else metadata('browser', { status: 'SKIPPED', reason: 'Run against a compiled v3 image with browser acceptance enabled' });
    metadata('complete', { status: 'PASS', sourceSha256, artifacts: source.artifacts.length, realModel: !replayFile, replayOfRealModel: Boolean(replayFile) });
  } finally { globalThis.fetch = originalFetch; }
}

try { await main(); }
catch (error) { metadata(phase, { status: 'FAIL', errorType: error instanceof Error ? error.name : 'Unknown' }); process.exitCode = 1; }
finally {
  await browser?.close();
  if (web && web.exitCode === null) {
    const stopped = new Promise<void>(resolve => web!.once('exit', () => resolve())); web.kill('SIGTERM');
    const timer = setTimeout(() => web?.kill('SIGKILL'), 3000); await stopped; clearTimeout(timer);
  }
  await prisma.$disconnect();
}
