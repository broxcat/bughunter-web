import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { suggestTestAccountHost } from '@/lib/targetReview';

const auth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth }));

const db = process.env.TEST_DATABASE_URL;
const suite = db ? describe : describe.skip;

suite('Target campaign read model and stream', () => {
  let prisma: typeof import('@/lib/prisma').prisma;
  let load: typeof import('@/server/targetCampaign').loadTargetCampaign;
  let stream: typeof import('@/app/api/programs/campaign-stream/route').GET;
  let ownerId: string, otherId: string, programId: string, assetId: string, targetId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = db;
    ({ prisma } = await import('@/lib/prisma'));
    ({ loadTargetCampaign: load } = await import('@/server/targetCampaign'));
    ({ GET: stream } = await import('@/app/api/programs/campaign-stream/route'));
    const users = await Promise.all(['owner', 'other'].map(label => prisma.user.create({
      data: { email: 'campaign-' + label + '-' + crypto.randomUUID() + '@example.test' },
    })));
    [ownerId, otherId] = users.map(user => user.id);
    const program = await prisma.bountyProgram.create({ data: { ownerId, companyName: 'Campaign read fixture', requiredUserAgent: 'Fixture/1',
      executionPolicies: { create: { version: 1, policy: { reviewState: 'OWNER_REVIEWED', automationAllowed: true,
        requiredUserAgent: 'Fixture/1', requiredHeaders: [], exclusions: [], requestsPerSecond: 1, maxConcurrency: 1,
        forbiddenCategories: [], sourceSnapshot: { url: null, rules: '', unrepresentedRules: [] } } } } } });
    programId = program.id;
    const asset = await prisma.scopeAsset.create({ data: {
      programId, originalValue: 'app.example.test', normalizedValue: 'app.example.test', format: 'SUBDOMAIN', type: 'WEB_APPLICATION',
    } });
    assetId = asset.id;
    const scope = await prisma.scope.create({ data: { userId: ownerId, hostPattern: 'app.example.test', status: 'APPROVED' } });
    const target = await prisma.target.create({ data: { userId: ownerId, programId, scopeId: scope.id, scopeAssetId: assetId, host: 'app.example.test' } });
    targetId = target.id;
  });

  afterAll(async () => {
    const owners = [ownerId, otherId].filter(Boolean);
    await prisma?.target.deleteMany({ where: { userId: { in: owners } } });
    await prisma?.bountyProgram.deleteMany({ where: { ownerId: { in: owners } } });
    await prisma?.scope.deleteMany({ where: { userId: { in: owners } } });
    await prisma?.user.deleteMany({ where: { id: { in: owners } } });
    await prisma?.$disconnect();
  });

  it('uses stored scope snapshots and finding counts, without exposing another owner’s stream', async () => {
    const request = () => new Request('http://app.example.test/api/programs/campaign-stream?ids=' + programId);
    const initial = await load(ownerId, programId);
    expect(initial?.view.action).toEqual({ label: 'Start recon', command: 'start' });
    expect(initial?.view.activity.active).toBe(false);
    expect(await load(otherId, programId)).toBeNull();
    auth.mockResolvedValue({ user: { id: otherId } });
    expect((await stream(request())).status).toBe(404);

    const run = await prisma.targetReconRun.create({ data: { programId, status: 'RUNNING' } });
    const scan = await prisma.scanRun.create({ data: {
      targetId, scopeAssetId: assetId, targetReconRunId: run.id, type: 'RECON', status: 'RUNNING',
      scopeAssetSnapshot: { normalizedValue: 'app.example.test', format: 'SUBDOMAIN', type: 'WEB_APPLICATION', assetValue: 'MEDIUM' },
    } });
    const running = await load(ownerId, programId);
    expect(running?.view.current).toMatchObject({ stage: 'Recon', state: 'running', detail: '0/1 assets finished' });
    auth.mockResolvedValue({ user: { id: ownerId } });
    const active = await stream(request());
    const reader = active.body!.getReader();
    const event = new TextDecoder().decode((await reader.read()).value);
    expect(event).toContain('"active":true');
    expect(event).not.toContain('app.example.test');
    await reader.cancel();

    await prisma.$transaction([
      prisma.scanRun.update({ where: { id: scan.id }, data: { status: 'COMPLETED', outcome: 'SUCCESS' } }),
      prisma.targetReconRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', outcome: 'SUCCESS', scopeMarkdown: 'Fixture' } }),
    ]);
    expect((await load(ownerId, programId))?.view.action).toMatchObject({ label: 'Open research' });
    const idle = await stream(request());
    expect(await idle.text()).toContain('"active":false');

    await prisma.scopeAsset.update({ where: { id: assetId }, data: { assetValue: 'HIGH' } });
    expect((await load(ownerId, programId))?.view.current.detail).toBe('Scope changed since the last run.');
    await prisma.finding.create({ data: { targetId, title: 'Manual review fixture' } });
    const withFinding = await load(ownerId, programId);
    expect(withFinding?.view.current).toMatchObject({ stage: 'Findings', state: 'needs you', detail: '0/1 reviewed' });
    expect(withFinding?.view.activity.active).toBe(false);
  });
});

describe('wildcard test account host suggestion', () => {
  it('requires a covered host, preserves exclusions and ignores an existing exact boundary', () => {
    const wildcard = [{ value: '*.example.test', type: 'WILDCARD' as const }];
    const login = 'https://login.example.test/login';
    expect(suggestTestAccountHost(wildcard, [], login)).toBe('login.example.test');
    expect(suggestTestAccountHost(wildcard, [], 'https://outside.test/login')).toBeNull();
    expect(suggestTestAccountHost(wildcard, ['login.example.test'], login)).toBeNull();
    expect(suggestTestAccountHost(wildcard, ['https://login.example.test/login/*'], login)).toBeNull();
    expect(suggestTestAccountHost([...wildcard, { value: 'login.example.test', type: 'WEB_APPLICATION' }], [], login)).toBeNull();
  });
});
