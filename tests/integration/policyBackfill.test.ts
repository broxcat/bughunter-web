
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const testDatabase = process.env.TEST_DATABASE_URL;
const schema = 'policy_backfill_' + randomUUID().replaceAll('-', '');
const auth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth }));

describe.skipIf(!testDatabase)('lossless execution policy backfill', () => {
  let prisma: PrismaClient;
  const priorUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    const url = new URL(testDatabase!);
    url.searchParams.set('schema', schema);
    process.env.DATABASE_URL = url.href;
    const require = createRequire(import.meta.url);
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env });
    ({ prisma } = await import('@/lib/prisma'));
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await prisma.$disconnect();
    }
    if (priorUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorUrl;
  });

  it('previews and imports drafts once, preserves history, then requires reviewed sources and exclusion parity', async () => {
    const { backfillExecutionPolicies } = await import('@/server/backfillExecutionPolicies');
    const { GET, PATCH } = await import('@/app/api/programs/[id]/route');
    const { programCollection } = await import('@/server/programCollection');
    const { loadTargetExecution, assertExecutionUrl } = await import('@/server/execution');
    const { MISSING_HUNTER_UA } = await import('@/lib/programExecutionPolicy');
    const user = await prisma.user.create({ data: { email: 'policy@example.test' } });
    auth.mockResolvedValue({ user: { id: user.id } });
    const programRules = '  At most one request per second.\nIdentify manually.  ';
    const outOfScope = ['admin.example.test', '*.internal.example.test'];
    const legacy = await prisma.bountyProgram.create({ data: {
      ownerId: user.id, companyName: 'Legacy', requiredUserAgent: 'Fixture/1',
      scopeRules: ['app.example.test'], outOfScope, rulesOfEngagement: programRules,
    } });
    const invalid = await prisma.bountyProgram.create({ data: {
      ownerId: user.id, companyName: 'Invalid legacy', requiredUserAgent: 'Fixture/1', outOfScope: ['Contact program first'],
    } });
    const manual = await prisma.bountyProgram.create({ data: {
      ownerId: user.id, companyName: 'Manual', requiredUserAgent: 'Manual/1',
      executionPolicies: { create: { version: 1, policy: {
        automationAllowed: true, requiredUserAgent: 'Manual/1', requiredHeaders: [],
        exclusions: [], requestsPerSecond: 2, maxConcurrency: 1, forbiddenCategories: [],
        sourceSnapshot: { url: null, rules: '', unrepresentedRules: [] },
      } } },
    } });
    const scope = await prisma.scope.create({ data: {
      userId: user.id, hostPattern: 'app.example.test', status: 'APPROVED',
      scopeDetails: '  Public pages only.  ', outOfScope: 'Exclude /admin.', rulesOfEngagement: 'No fuzzing.',
    } });
    const target = await prisma.target.create({ data: {
      userId: user.id, scopeId: scope.id, programId: legacy.id, host: 'app.example.test', active: true,
    } });
    const asset = await prisma.scopeAsset.create({ data: {
      programId: legacy.id, normalizedValue: 'app.example.test', originalValue: 'app.example.test', format: 'SUBDOMAIN', type: 'WEB_APPLICATION',
    } });
    const hunt = await prisma.scanRun.create({ data: { targetId: target.id, type: 'HUNT', status: 'COMPLETED', huntReport: { legacy: true } } });
    const recon = await prisma.scanRun.create({ data: { targetId: target.id, scopeAssetId: asset.id, type: 'RECON', status: 'COMPLETED' } });
    const plan = await prisma.researchPlan.create({ data: {
      programId: legacy.id, targetId: target.id, scopeAssetId: asset.id, scanRunId: recon.id,
      sourceFingerprint: 'fixture-plan', methodologyVersion: 'legacy', metadata: { evidence: 'Original plan' },
    } });
    const session = await prisma.researchSession.create({ data: {
      userId: user.id, targetId: target.id, workspaceId: randomUUID(), targetHost: target.host,
      programName: legacy.companyName, researchPlanId: plan.id, scopeMarkdown: 'Original Research evidence', authorizationSnapshot: { legacy: true },
    } });
    const report = await prisma.report.create({ data: { userId: user.id, targetId: target.id, title: 'Original report' } });
    const params = { params: Promise.resolve({ id: legacy.id }) };
    const request = () => new Request('http://localhost/api/programs/' + legacy.id);
    const preview = await GET(request(), params);
    expect(preview.status).toBe(200);
    expect(await prisma.programExecutionPolicy.count()).toBe(1);

    expect(await backfillExecutionPolicies(true)).toMatchObject({
      programsProcessed: 3, programsBlockedAfterBackfill: 2, draftsPlanned: 2, draftsCreated: 0, existingPoliciesKept: 1,
      unconvertibleExclusions: [{ programId: invalid.id, index: 0, value: 'Contact program first', reason: expect.any(String) }],
    });
    expect(await prisma.programExecutionPolicy.count()).toBe(1);
    expect(await backfillExecutionPolicies(false)).toMatchObject({ draftsCreated: 2 });
    expect(await backfillExecutionPolicies(false)).toMatchObject({ draftsCreated: 0, existingPoliciesKept: 3 });
    const read = async () => prisma.programExecutionPolicy.findMany({ where: { programId: legacy.id }, orderBy: { version: 'asc' } });
    const [draft] = await read();
    expect(draft.policy).toMatchObject({
      reviewState: 'BACKFILL_DRAFT', automationAllowed: false, requestsPerSecond: null, maxConcurrency: null,
      requiredHeaders: [], forbiddenCategories: [], exclusions: outOfScope,
      sourceSnapshot: {
        legacy: { outOfScope, programRules, scopes: [{ id: scope.id, scopeDetails: scope.scopeDetails, outOfScope: scope.outOfScope, rulesOfEngagement: scope.rulesOfEngagement }] },
        unrepresentedRules: [programRules, scope.scopeDetails, scope.outOfScope, scope.rulesOfEngagement],
      },
    });
    expect(await prisma.bountyProgram.findUnique({ where: { id: legacy.id } })).toEqual(legacy);
    expect(await prisma.scope.findUnique({ where: { id: scope.id } })).toEqual(scope);
    expect(await prisma.target.findUnique({ where: { id: target.id } })).toEqual(target);
    expect(await prisma.scopeAsset.findUnique({ where: { id: asset.id } })).toEqual(asset);
    expect(await prisma.scanRun.findUnique({ where: { id: hunt.id } })).toEqual(hunt);
    expect(await prisma.researchPlan.findUnique({ where: { id: plan.id } })).toEqual(plan);
    expect(await prisma.researchSession.findUnique({ where: { id: session.id } })).toEqual(session);
    expect(await prisma.report.findUnique({ where: { id: report.id } })).toEqual(report);
    expect(await prisma.programExecutionPolicy.count({ where: { programId: manual.id } })).toBe(1);

    const collectionBlocker = async () => (await programCollection(user.id, { page: 1, pageSize: 10, q: '' })).items.find(item => item.id === legacy.id)!.policyBlocker;
    const draftBlocker = await collectionBlocker();
    expect(draftBlocker).toMatch(/review and save/);
    await expect(loadTargetExecution(target.id)).rejects.toThrow(draftBlocker!);
    const { legacyPolicyReview: { scopeFingerprint } } = await (await GET(request(), params)).json();
    const policy = {
      automationAllowed: true, requiredUserAgent: 'Fixture/1', requiredHeaders: [],
      exclusions: [...outOfScope, 'https://app.example.test/admin/*'], requestsPerSecond: 1, maxConcurrency: 1,
      forbiddenCategories: ['FUZZING'], sourceSnapshot: { url: null, rules: programRules.trim(), unrepresentedRules: [] },
    };
    const patch = (payload: object) => PATCH(new Request(request().url, { method: 'PATCH', body: JSON.stringify(payload) }), params);
    const revision = { expectedPolicyVersion: 1, expectedLegacyScopeFingerprint: scopeFingerprint };
    expect((await patch({ executionPolicy: policy })).status).toBe(409);
    expect((await patch({ ...revision, executionPolicy: { ...policy, exclusions: [] } })).status).toBe(400);
    expect((await patch({ ...revision, executionPolicy: policy })).status).toBe(200);
    expect((await read()).map(row => row.version)).toEqual([1, 2]);
    expect((await read())[0]).toEqual(draft);
    expect(await collectionBlocker()).toBeNull();
    const execution = await loadTargetExecution(target.id);
    expect(() => assertExecutionUrl('https://app.example.test/admin/x', execution)).toThrow('out of scope');
    expect(() => assertExecutionUrl('https://app.example.test/app', execution)).not.toThrow();
    expect((await prisma.bountyProgram.findUniqueOrThrow({ where: { id: legacy.id } })).outOfScope).toEqual(outOfScope);

    await prisma.scope.update({ where: { id: scope.id }, data: { scopeDetails: 'Changed restriction' } });
    const changedBlocker = await collectionBlocker();
    expect(changedBlocker).toMatch(/unrepresented/);
    await expect(loadTargetExecution(target.id)).rejects.toThrow(changedBlocker!);
    expect((await patch({ ...revision, expectedPolicyVersion: 2, executionPolicy: policy })).status).toBe(409);

    await prisma.bountyProgram.create({ data: { ownerId: user.id, companyName: 'Needs UA', requiredUserAgent: '' } });
    expect((await programCollection(user.id, { page: 1, pageSize: 10, q: 'Needs UA' })).items[0].policyBlocker).toBe(MISSING_HUNTER_UA);
  }, 30_000);
});
