import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
const auth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth }));
const db = process.env.TEST_DATABASE_URL, schema = 'automation_decisions_' + randomUUID().replaceAll('-', '');
const first = 'No automated scanners', second = "Don't use automated tools";
describe.skipIf(!db)('owner decision for one exact automation phrase', () => {
  let p: PrismaClient, userId: string;
  let post: typeof import('@/app/api/programs/[id]/automation-decision/route').POST;
  let resolve: typeof import('@/server/programExecutionPolicy').resolveProgramPolicy;
  let load: typeof import('@/server/targetCampaign').loadTargetCampaign;
  beforeAll(async () => {
    const url = new URL(db!); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.href;
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma: p } = await import('@/lib/prisma'));
    ({ POST: post } = await import('@/app/api/programs/[id]/automation-decision/route'));
    ({ resolveProgramPolicy: resolve } = await import('@/server/programExecutionPolicy'));
    ({ loadTargetCampaign: load } = await import('@/server/targetCampaign'));
    userId = (await p.user.create({ data: { email: randomUUID() + '@example.test' } })).id;
    auth.mockResolvedValue({ user: { id: userId } });
  }, 60000);
  afterAll(async () => { if (p) { await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await p.$disconnect(); } });
  async function fixture(phrase = first) {
    return p.bountyProgram.create({ data: { ownerId: userId, companyName: 'Decision fixture', requiredUserAgent: 'Decision/1', rulesOfEngagement: phrase,
      scopeAssets: { create: { originalValue: 'app.example.test', normalizedValue: 'app.example.test', format: 'SUBDOMAIN', type: 'WEB_APPLICATION' } },
      campaign: { create: { state: 'BLOCKED', reason: 'The program policy does not allow automation.' } },
      executionPolicies: { create: { version: 1, policy: { automationAllowed: false, automationProhibition: phrase, requiredUserAgent: 'Decision/1',
        requiredHeaders: [{ name: 'x-program', value: 'fixture' }], exclusions: ['admin.example.test'], requestsPerSecond: 2, maxConcurrency: 1,
        forbiddenCategories: ['FUZZING'], sourceSnapshot: { url: null, rules: phrase, sourceDocument: '- ' + phrase, unrepresentedRules: [] } } } },
    } });
  }
  const request = (id: string, phrase = first, expectedPolicyVersion = 1, origin?: string) => post(new Request('http://app.example.test/api/programs/' + id + '/automation-decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ phrase, expectedPolicyVersion }),
  }), { params: Promise.resolve({ id }) });
  const policyProgram = (id: string) => p.bountyProgram.findUniqueOrThrow({ where: { id }, include: { executionPolicies: { orderBy: { version: 'desc' }, take: 1 }, campaign: true } });
  it('appends an auditable version, unlocks the Target and preserves all enforced configuration', async () => {
    const program = await fixture();
    expect((await load(userId, program.id))!.view.automationBlock).toEqual({ phrase: first, version: 1 });
    expect((await request(program.id)).status).toBe(200);
    const saved = await policyProgram(program.id);
    expect(saved.executionPolicies[0]).toMatchObject({ version: 2, policy: { automationAllowed: true, automationProhibition: first,
      automationDecisions: [{ phrase: first, decision: 'NOT_A_TESTING_BAN', userId, decidedAt: expect.any(String) }],
      requiredHeaders: [{ name: 'x-program', value: 'fixture' }], exclusions: ['admin.example.test'], requestsPerSecond: 2, maxConcurrency: 1, forbiddenCategories: ['FUZZING'] } });
    expect(await p.programExecutionPolicy.findUnique({ where: { programId_version: { programId: program.id, version: 1 } } })).toMatchObject({ policy: { automationAllowed: false } });
    expect(resolve(saved).blocker).toBeNull(); expect(saved.campaign).toMatchObject({ state: 'READY', reason: null });
    expect((await load(userId, program.id))!.view.automationBlock).toBeUndefined();
  });
  it('keeps the decision for the same sentence, and blocks a different sentence after source changes', async () => {
    const program = await fixture(); await request(program.id);
    await p.bountyProgram.update({ where: { id: program.id }, data: { rulesOfEngagement: 'New introduction.\n' + first } });
    expect(resolve(await policyProgram(program.id)).blocker).toBeNull();
    await p.bountyProgram.update({ where: { id: program.id }, data: { rulesOfEngagement: second } });
    expect(resolve(await policyProgram(program.id)).blocker).toContain(second);
    expect((await request(program.id, second, 2)).status).toBe(200);
    expect(resolve(await policyProgram(program.id)).blocker).toBeNull();
  });
  it('does not dismiss a second testing ban in the same program', async () => {
    const program = await fixture();
    await p.bountyProgram.update({ where: { id: program.id }, data: { rulesOfEngagement: first + '\n' + second } });
    await request(program.id);
    const saved = await policyProgram(program.id); expect(resolve(saved).blocker).toContain(second);
    expect(saved.campaign?.state).toBe('BLOCKED');
  });
  it('handles concurrent clicks idempotently and refuses stale or fabricated phrases', async () => {
    const program = await fixture();
    expect((await request(program.id, second)).status).toBe(409);
    expect((await request(program.id, first, 0)).status).toBe(409);
    const results = await Promise.all([request(program.id), request(program.id)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(await p.programExecutionPolicy.count({ where: { programId: program.id } })).toBe(2);
  });
  it('preserves phrase decisions when the existing settings API writes another policy version', async () => {
    const program = await fixture(); await request(program.id);
    const saved = await policyProgram(program.id);
    const { PATCH } = await import('@/app/api/programs/[id]/route');
    const response = await PATCH(new Request('http://app.example.test', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      expectedPolicyVersion: 2, executionPolicy: { automationAllowed: true, requiredUserAgent: 'Decision/2', requiredHeaders: [], exclusions: [],
        requestsPerSecond: 2, maxConcurrency: 1, forbiddenCategories: [], sourceSnapshot: { url: null, rules: first, unrepresentedRules: [] } },
    }) }), { params: Promise.resolve({ id: program.id }) });
    expect(response.status).toBe(200);
    const next = await policyProgram(program.id);
    expect(next.executionPolicies[0].policy).toMatchObject({ automationDecisions: (saved.executionPolicies[0].policy as { automationDecisions: unknown }).automationDecisions });
    expect(resolve(next).blocker).toBeNull();
  });
  it('requires authentication, ownership and a same-origin browser request', async () => {
    const program = await fixture();
    auth.mockResolvedValueOnce(null); expect((await request(program.id)).status).toBe(401);
    auth.mockResolvedValueOnce({ user: { id: 'another-owner' } }); expect((await request(program.id)).status).toBe(404);
    expect((await request(program.id, first, 1, 'https://foreign.example.test')).status).toBe(403);
    expect(await p.programExecutionPolicy.count({ where: { programId: program.id } })).toBe(1);
  });
});
