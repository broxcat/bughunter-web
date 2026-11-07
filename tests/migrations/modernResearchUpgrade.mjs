import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// Called only after the historical fixture has established its disposable DB.
// Use a separate random schema: never downgrade or rewrite the historical data.
export async function modernResearchUpgrade(url, historicalClient) {
  assert.equal(url, process.env.TEST_MIGRATION_DATABASE_URL);
  assert(await historicalClient.researchSession.findUnique({ where: { id: 'upgrade-research' } }));
  const namespace = `m8_upgrade_${randomUUID().replaceAll('-', '')}`;
  const fixtureUrl = new URL(url);
  fixtureUrl.searchParams.set('schema', namespace);
  const databaseUrl = fixtureUrl.toString();
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  const temp = await mkdtemp(join(tmpdir(), 'bughunter-modern-upgrade-'));
  const schema = resolve('prisma/schema.prisma');
  const migrate = path => execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', path], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' });
  try {
    await cp(schema, join(temp, 'schema.prisma'));
    await mkdir(join(temp, 'migrations'));
    for (const entry of await readdir('prisma/migrations')) {
      if (entry <= '20261106150000_finding_lifecycle_retest' || entry === 'migration_lock.toml') {
        await cp(join('prisma/migrations', entry), join(temp, 'migrations', entry), { recursive: true });
      }
    }
    migrate(join(temp, 'schema.prisma'));
    assert.equal((await client.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations"'))[0].count, 37);
    const user = await client.user.create({ data: { email: 'modern-upgrade@example.test' } });
    const program = await client.bountyProgram.create({ data: { ownerId: user.id, companyName: 'Disposable modern upgrade', requiredUserAgent: 'UpgradeFixture/1', scopeRules: ['fixture.example.test'] } });
    const scope = await client.scope.create({ data: { userId: user.id, hostPattern: 'fixture.example.test', status: 'APPROVED' } });
    const asset = await client.scopeAsset.create({ data: { programId: program.id, originalValue: 'fixture.example.test', normalizedValue: 'fixture.example.test', format: 'SUBDOMAIN', type: 'WEB_APPLICATION' } });
    const target = await client.target.create({ data: { userId: user.id, programId: program.id, scopeId: scope.id, scopeAssetId: asset.id, host: 'fixture.example.test' } });
    const run = await client.scanRun.create({ data: { targetId: target.id, scopeAssetId: asset.id, type: 'RECON', status: 'COMPLETED', outcome: 'SUCCESS', scopeMarkdown: 'Historical immutable Scope snapshot', reconCorpus: { version: 1, fixture: true } } });
    const artifact = await client.reconArtifact.create({ data: { scanRunId: run.id, scopeAssetId: asset.id, kind: 'endpoint', canonicalKey: 'GET:/objects/fixture', value: { url: 'https://fixture.example.test/objects/fixture' }, scopeState: 'IN_SCOPE', verification: 'OBSERVED', sources: [], firstSeenAt: new Date(), lastSeenAt: new Date() } });
    const plan = await client.researchPlan.create({ data: { targetId: target.id, programId: program.id, scopeAssetId: asset.id, scanRunId: run.id, sourceFingerprint: 'fixture-fingerprint', methodologyVersion: 'research-plan/1', assessmentMode: 'BLACK_BOX', metadata: { fixture: true } } });
    const item = await client.researchPlanItem.create({ data: { planId: plan.id, stableKey: 'object-access', category: 'AUTHORIZATION', priority: 'HIGH', title: 'Review object access', objective: 'Compare controlled object access', rationale: 'Fixture evidence', methodology: 'Controlled accounts', surfaceRefs: [], evidenceRefs: [], contextRefs: [], runtimeSignals: [], sourceSignals: [], sourceEvidenceRefs: [], score: 10, evidenceStrength: 5 } });
    // Select only old fields: publicationManifest does not exist at migration 37.
    const session = await client.researchSession.create({ data: { userId: user.id, targetId: target.id, workspaceId: randomUUID(), status: 'READY', targetHost: target.host, programName: program.companyName, scopeMarkdown: run.scopeMarkdown, authorizationSnapshot: { version: 1, targetId: target.id, fixture: true }, researchPlanId: plan.id, reconScanRunId: run.id, files: ['scope.md', 'research/notes.md'], exportSha256: 'fixture-export' }, select: { id: true } });
    const hypothesis = await client.researchHypothesis.create({ data: { sessionId: session.id, planItemId: item.id, externalId: 'H-001', title: 'Controlled historical hypothesis', status: 'CONFIRMED', hypothesis: 'Fixture hypothesis', evidenceFor: ['EV-original'], evidenceAgainst: [], nextTest: 'Retest separately', expectedSignal: 'Access denied after fix', falsificationCondition: 'No reproducible difference', contentSha256: 'fixture-hypothesis' } });
    await client.researchHypothesisRevision.create({ data: { hypothesisId: hypothesis.id, revision: 1, snapshot: { status: 'CONFIRMED', fixture: true } } });
    const coverage = await client.researchCoverage.create({ data: { targetId: target.id, scopeAssetId: asset.id, scopeAssetReferenceId: asset.id, planItemId: item.id, planItemReferenceId: item.id, objectiveKey: 'object-access', coverageKey: 'fixture-coverage', category: 'AUTHORIZATION', surface: '/objects/fixture', method: 'GET', contextKey: 'ACCOUNT_A', contextLabel: 'Controlled account A', contextRunId: run.id, testKey: 'controlled-object', revision: 1, state: 'NEEDS_RETEST' } });
    const event = await client.researchCoverageEvent.create({ data: { coverageId: coverage.id, targetId: target.id, eventKey: randomUUID(), contentSha256: 'fixture-event', revision: 1, state: 'NEEDS_RETEST', action: 'Compared controlled fixture accounts', result: 'Separate retest required', evidence: ['EV-original'], performedAt: new Date(), actorId: user.id, source: 'MANUAL', sessionId: session.id, sessionReferenceId: session.id, hypothesisReferenceId: hypothesis.id } });
    for (const id of ['EV-original', 'EV-retest']) {
      await client.evidenceRecord.create({ data: { id, targetId: target.id, sessionId: session.id, sessionReferenceId: session.id, kind: 'HTTP_REQUEST_RESPONSE', sourceKey: id, description: `Synthetic ${id}`, provenance: { fixture: true }, redactionStatus: 'REDACTED', contentSha256: id, metadata: { status: id === 'EV-original' ? 200 : 403 }, reconArtifactId: artifact.id, reconArtifactReferenceId: artifact.id } });
    }
    const finding = await client.finding.create({ data: { targetId: target.id, scanRunId: run.id, title: 'Human-reviewed fixture', reviewStatus: 'CONFIRMED', lifecycle: 'RETEST_REQUIRED', lifecycleRevision: 1 } });
    await client.findingLifecycleEvent.create({ data: { findingId: finding.id, revision: 1, eventKey: randomUUID(), contentSha256: 'fixture-review', state: 'RETEST_REQUIRED', actorId: user.id, reason: 'Historical reviewed finding needs separate evidence' } });
    const retest = await client.findingRetest.create({ data: { findingId: finding.id, requestedBy: user.id, reason: 'Verify the controlled fixture fix', originalEvidenceIds: ['EV-original'] } });
    await client.findingRetestResult.create({ data: { retestId: retest.id, outcome: 'FIX_CONFIRMED', actorId: user.id, sessionReferenceId: session.id, performedAt: new Date(), conclusion: 'Separate fixture response denies access', evidenceIds: ['EV-retest'] } });
    const report = await client.report.create({ data: { userId: user.id, targetId: target.id, title: 'Reviewed historical fixture report', items: { create: { findingId: finding.id } } } });
    await client.evidenceHypothesis.create({ data: { evidenceId: 'EV-original', hypothesisId: hypothesis.id, hypothesisReferenceId: hypothesis.id, revision: 1, role: 'SUPPORTS' } });
    await client.evidenceFinding.create({ data: { evidenceId: 'EV-original', findingId: finding.id, findingReferenceId: finding.id, role: 'SUPPORTS' } });
    await client.evidenceCoverage.create({ data: { evidenceId: 'EV-original', coverageEventId: event.id } });
    await client.evidenceReport.create({ data: { evidenceId: 'EV-original', reportId: report.id, reportReferenceId: report.id } });
    const history = await client.reconHistoryRun.create({ data: { targetId: target.id, scopeAssetReferenceId: asset.id, scanRunId: run.id, scanReferenceId: run.id, runCreatedAt: run.createdAt, outcome: 'SUCCESS' } });
    const surface = await client.reconSurface.create({ data: { id: 'fixture-surface', targetId: target.id, scopeAssetReferenceId: asset.id, kind: 'endpoint', identity: 'GET:/objects/fixture', label: 'Fixture endpoint', firstSeenAt: run.createdAt, lastSeenAt: run.createdAt } });
    await client.reconSurfaceSeen.create({ data: { surfaceId: surface.id, historyId: history.id, fingerprint: 'fixture-surface', details: { fixture: true }, sourceRefs: [artifact.id] } });

    // Compare every pre-existing column of every product table, including clocks,
    // references and JSON. New nullable fields are checked separately below.
    const columns = await client.$queryRaw`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = ${namespace} AND table_name <> '_prisma_migrations' ORDER BY table_name, ordinal_position`;
    const tables = new Map();
    const quote = value => `"${value.replaceAll('"', '""')}"`;
    for (const { table_name: table, column_name: column } of columns) tables.set(table, [...(tables.get(table) ?? []), column]);
    const snapshot = async () => Object.fromEntries(await Promise.all([...tables].map(async ([table, names]) => {
      const selection = names.map(quote).join(',');
      return [table, await client.$queryRawUnsafe(`SELECT ${selection} FROM ${quote(namespace)}.${quote(table)} ORDER BY to_jsonb(ROW(${selection}))::text`)];
    })));
    const before = await snapshot();
    migrate(schema);
    assert.deepEqual(await snapshot(), before, 'Migration must preserve all populated historical product rows');
    assert.equal((await client.researchSession.findUniqueOrThrow({ where: { id: session.id } })).publicationManifest, null);
    assert.equal(await client.targetScopeContext.count(), 0);
    execFileSync('npx', ['prisma', 'migrate', 'diff', '--from-url', databaseUrl, '--to-schema-datamodel', schema, '--exit-code'], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' });
    console.log(`M8_MODERN_UPGRADE_PASS: migrations 37→39; ${Object.values(before).reduce((n, rows) => n + rows.length, 0)} populated rows preserved across ${tables.size} tables; Scope snapshots, Recon history, Plan, Coverage, hypotheses, evidence links, Finding review, distinct Retest proof and Report; schema drift absent.`);
  } finally {
    await client.$disconnect();
    await historicalClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await rm(temp, { recursive: true, force: true });
  }
}
