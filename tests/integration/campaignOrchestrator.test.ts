import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CampaignSource } from '@/lib/campaignSource';

const db = process.env.TEST_DATABASE_URL;
const suite = db ? describe : describe.skip;
const crash = (state: string) => { throw new Error('simulated crash before ' + state); };
const host = (name: string) => name + '.example.test';
const assets = (...names: string[]) => names.map(name => ({ value: host(name), type: 'WEB_APPLICATION' as const }));

suite('durable Target campaign', () => {
  let p: typeof import('@/lib/prisma').prisma;
  let advance: typeof import('@/server/campaignOrchestrator').advanceCampaign;
  let change: typeof import('@/server/campaignOrchestrator').changeCampaign;
  let sync: typeof import('@/server/campaignResync').resyncCampaign;
  let owner: string;
  let programIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = db;
    ({ prisma: p } = await import('@/lib/prisma'));
    ({ advanceCampaign: advance, changeCampaign: change } = await import('@/server/campaignOrchestrator'));
    ({ resyncCampaign: sync } = await import('@/server/campaignResync'));
    owner = (await p.user.create({ data: { email: 'campaign-state-' + crypto.randomUUID() + '@example.test' } })).id;
  });
  afterEach(async () => {
    if (programIds.length) {
      await p.target.deleteMany({ where: { userId: owner, programId: { in: programIds } } });
      await p.bountyProgram.deleteMany({ where: { ownerId: owner, id: { in: programIds } } });
      await p.scope.deleteMany({ where: { userId: owner } });
    }
    programIds = [];
    vi.unstubAllEnvs();
  });
  afterAll(async () => { if (owner) await p.user.delete({ where: { id: owner } }); await p?.$disconnect(); });

  async function target(names: string[], options: { allow?: boolean; source?: CampaignSource; interval?: number } = {}) {
    const program = await p.bountyProgram.create({ data: {
      ownerId: owner, companyName: 'Campaign fixture', requiredUserAgent: 'Fixture/1',
      platform: options.source?.platform ?? 'PRIVATE', programUrl: options.source?.url,
      scopeAssets: { create: assets(...names).map(asset => ({ originalValue: asset.value,
        normalizedValue: asset.value, format: 'SUBDOMAIN', type: asset.type })) },
      executionPolicies: { create: { version: 1, policy: {
        reviewState: 'OWNER_REVIEWED', automationAllowed: options.allow ?? true, requiredUserAgent: 'Fixture/1',
        requiredHeaders: [], exclusions: [], requestsPerSecond: 1, maxConcurrency: 1, forbiddenCategories: [],
        sourceSnapshot: { url: options.source?.url ?? null, rules: '', unrepresentedRules: [], ruleDecisions: [] },
      } } },
    } });
    programIds.push(program.id);
    if (options.source || options.interval) await p.targetCampaign.create({ data: {
      programId: program.id, requestedAt: new Date(), source: options.source, intervalMinutes: options.interval,
    } });
    return program.id;
  }
  const state = (programId: string) => p.targetCampaign.findUniqueOrThrow({ where: { programId } });
  const runs = (programId: string) => p.targetReconRun.findMany({ where: { programId }, include: { scans: { include: { scopeAsset: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const outbox = (programId: string) => p.scanJobOutbox.count({ where: { scanRun: { target: { programId } } } });
  async function finish(runId: string, success: boolean) {
    const startedAt = new Date(Date.now() + 1000);
    await p.$transaction([
      p.scanRun.updateMany({ where: { targetReconRunId: runId, status: { not: 'CANCELLED' } }, data: {
        status: success ? 'COMPLETED' : 'FAILED', outcome: success ? 'SUCCESS' : 'FAILED', startedAt,
      } }),
      p.targetReconRun.update({ where: { id: runId }, data: {
        status: success ? 'COMPLETED' : 'FAILED', outcome: success ? 'SUCCESS' : 'FAILED',
        finishedAt: startedAt, scopeMarkdown: success ? 'Prepared Recon handoff fixture.' : null,
      } }),
    ]);
  }

  it('rolls back a crash at admission and handoff, then resumes without duplicate jobs', async () => {
    const id = await target(['first', 'second']);
    await expect(change(owner, id, 'start', crash)).rejects.toThrow('READY');
    expect(await p.targetCampaign.findUnique({ where: { programId: id } })).toBeNull();
    await change(owner, id, 'start');
    await expect(advance(owner, id, { beforeCommit: crash })).rejects.toThrow('RECON_RUNNING');
    expect((await state(id)).state).toBe('READY');
    expect(await outbox(id)).toBe(0);
    await Promise.all([advance(owner, id), advance(owner, id)]);
    const [run] = await runs(id);
    expect(run.campaignKey).toBe(id + ':1:1:recon');
    expect(await outbox(id)).toBe(2);
    await finish(run.id, true);
    await expect(advance(owner, id, { beforeCommit: crash })).rejects.toThrow('RESEARCH_PENDING');
    expect((await state(id)).handoffRunId).toBeNull();
    await advance(owner, id);
    await advance(owner, id);
    expect(await state(id)).toMatchObject({ state: 'RESEARCH_PENDING', handoffRunId: run.id });
    await expect(change(owner, id, 'handoff', crash)).rejects.toThrow('MONITORING');
    expect((await state(id)).state).toBe('RESEARCH_PENDING');
    await change(owner, id, 'handoff');
    await change(owner, id, 'handoff');
    expect(await state(id)).toMatchObject({ state: 'MONITORING', nextCycleAt: null });
    expect(await outbox(id)).toBe(2);
    expect(await p.researchSession.count({ where: { target: { programId: id } } })).toBe(0);
    expect(await p.finding.count({ where: { target: { programId: id } } })).toBe(0);
  });

  it('pauses queued scans, drains the running one and resumes only the untested asset', async () => {
    const id = await target(['draining', 'queued']);
    await change(owner, id, 'start');
    await advance(owner, id);
    const [run] = await runs(id);
    const [active, queued] = [...run.scans].sort((a, b) => a.scopeAsset!.normalizedValue.localeCompare(b.scopeAsset!.normalizedValue));
    await p.scanRun.update({ where: { id: active.id }, data: { status: 'RUNNING', startedAt: new Date() } });
    await expect(change(owner, id, 'pause', crash)).rejects.toThrow('PAUSED');
    expect((await p.scanRun.findUniqueOrThrow({ where: { id: queued.id } })).cancelRequestedAt).toBeNull();
    await change(owner, id, 'pause');
    await change(owner, id, 'pause');
    expect((await p.scanRun.findUniqueOrThrow({ where: { id: active.id } })).cancelRequestedAt).toBeNull();
    expect((await p.scanRun.findUniqueOrThrow({ where: { id: queued.id } })).cancelRequestedAt).not.toBeNull();
    await expect(change(owner, id, 'resume', crash)).rejects.toThrow('READY');
    expect((await state(id)).state).toBe('PAUSED');
    await change(owner, id, 'resume');
    await advance(owner, id);
    expect(await runs(id)).toHaveLength(1);
    await p.scanRun.update({ where: { id: queued.id }, data: { status: 'CANCELLED' } });
    await finish(run.id, true);
    await advance(owner, id);
    const followup = (await runs(id)).find(row => row.id !== run.id)!;
    expect(followup.campaignKey).toBe(id + ':1:2:recon');
    expect(followup.scans.map(scan => scan.scopeAsset?.normalizedValue)).toEqual([host('queued')]);
  });

  it('retries failure with backoff and stops after three attempts', async () => {
    const id = await target(['failing']);
    await change(owner, id, 'start');
    await advance(owner, id);
    let now = new Date(Date.now() + 1000);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { reconRunId } = await state(id);
      await finish(reconRunId!, false);
      await expect(advance(owner, id, { now, beforeCommit: crash })).rejects.toThrow('FAILED');
      await advance(owner, id, { now });
      const row = await state(id);
      expect(row).toMatchObject({ state: 'FAILED', attempt, reason: 'Recon failed without usable results.' });
      await advance(owner, id, { now });
      expect(await outbox(id)).toBe(attempt);
      if (attempt < 3) {
        expect(+row.retryAt! - +now).toBe(2 ** (attempt - 1) * 60_000);
        now = row.retryAt!;
        await advance(owner, id, { now });
      } else expect(row.retryAt).toBeNull();
    }
  });

  it('schedules only changed assets and never queues a policy that disallows automation', async () => {
    const denied = await target(['denied'], { allow: false, interval: 60 });
    await expect(advance(owner, denied, { beforeCommit: crash })).rejects.toThrow('BLOCKED');
    await advance(owner, denied);
    expect(await state(denied)).toMatchObject({ state: 'BLOCKED', requestedAt: null, retryAt: null, nextCycleAt: null });
    expect(await outbox(denied)).toBe(0);

    const id = await target(['unchanged', 'changed'], { interval: 60 });
    await advance(owner, id);
    const first = (await runs(id))[0];
    await finish(first.id, true);
    await advance(owner, id);
    await change(owner, id, 'handoff');
    const now = (await state(id)).nextCycleAt!;
    const modified = first.scans.find(scan => scan.scopeAsset?.normalizedValue === host('changed'))!;
    await p.scopeAsset.update({ where: { id: modified.scopeAssetId! }, data: { assetValue: 'HIGH', updatedAt: new Date(Date.now() + 5000) } });
    await advance(owner, id, { now });
    const followup = (await runs(id)).find(row => row.id !== first.id)!;
    expect(followup.campaignKey).toBe(id + ':2:1:recon');
    expect(followup.scans.map(scan => scan.scopeAsset?.normalizedValue)).toEqual([host('changed')]);
  });

  it('serializes the global Target limit across concurrent workers', async () => {
    vi.stubEnv('TARGET_CAMPAIGN_MAX_ACTIVE', '1');
    const ids = await Promise.all([target(['one']), target(['two'])]);
    await Promise.all(ids.map(id => change(owner, id, 'start')));
    await Promise.all(ids.map(id => advance(owner, id)));
    expect((await Promise.all(ids.map(state))).map(row => row.state).sort()).toEqual(['READY', 'RECON_RUNNING']);
  });

  it('applies restrictions, proposes extensions, and blocks changed rules without testing pending scope', async () => {
    const source: CampaignSource = {
      platform: 'HACKERONE', url: 'https://hackerone.com/example-program', grants: [host('removed'), host('restricted')],
      assets: assets('removed', 'restricted'), exclusions: [], forbiddenCategories: [], rules: [], nonQualifying: [],
    };
    const id = await target(['removed', 'restricted', 'manual'], { source });
    await advance(owner, id);
    const run = (await runs(id))[0];
    await p.scanRun.updateMany({ where: { targetReconRunId: run.id }, data: { status: 'RUNNING', startedAt: new Date() } });
    const now = new Date();
    const fresh: CampaignSource = {
      ...source, grants: [host('restricted'), host('pending')], assets: assets('restricted', 'pending'),
      exclusions: ['https://' + host('restricted') + '/admin/*'],
    };
    const fetch = vi.fn(async () => fresh);
    await Promise.all([sync(owner, id, now, fetch), sync(owner, id, now, fetch)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await state(id)).toMatchObject({ state: 'RECON_RUNNING', pendingAssets: assets('pending') });
    expect(await p.scopeAsset.findFirst({ where: { programId: id, normalizedValue: host('pending') } })).toBeNull();
    expect(await p.scopeAsset.findFirst({ where: { programId: id, normalizedValue: host('removed') } })).toMatchObject({ active: false });
    const affected = (await runs(id))[0].scans.filter(scan => scan.cancelRequestedAt).map(scan => scan.scopeAsset?.normalizedValue).sort();
    expect(affected).toEqual([host('removed'), host('restricted')]);
    const policy = () => p.programExecutionPolicy.findFirstOrThrow({ where: { programId: id }, orderBy: { version: 'desc' } });
    expect((await policy()).policy).toMatchObject({ exclusions: fresh.exclusions });

    const tomorrow = new Date(+now + 86_400_000);
    await sync(owner, id, tomorrow, async () => ({ ...fresh, forbiddenCategories: ['FUZZING'] }));
    expect((await policy()).policy).toMatchObject({ forbiddenCategories: ['FUZZING'] });
    await sync(owner, id, new Date(+tomorrow + 86_400_000), async () => ({ ...fresh, rules: [{ text: 'Only test during an agreed window.' }] }));
    expect(await state(id)).toMatchObject({ state: 'BLOCKED', nextCycleAt: null, requestedAt: null });
    expect((await policy()).policy).toMatchObject({ sourceSnapshot: { unrepresentedRules: expect.arrayContaining(['Only test during an agreed window.']) } });
    expect(await outbox(id)).toBe(3);
  });
});
