import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { campaignPolicyBlocker } from '@/server/campaignOrchestrator';
import { programPolicyInclude } from '@/server/programExecutionPolicy';

const db = process.env.TEST_DATABASE_URL;
const schema = 'active_policy_' + randomUUID().replaceAll('-', '');
describe.skipIf(!db)('draft policy activation migration', () => {
  let p: PrismaClient;
  beforeAll(async () => {
    const url = new URL(db!); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.href;
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma: p } = await import('@/lib/prisma'));
  }, 60000);
  afterAll(async () => { if (p) { await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await p.$disconnect(); } });
  it('appends active versions, preserves explicit bans and history, and releases review campaigns once', async () => {
    const owner = await p.user.create({ data: { email: randomUUID() + '@example.test' } });
    const cases = [
      ['BACKFILL_DRAFT', 'Identify yourself. Special testing window.', true],
      ['IMPORT_DRAFT', 'Automation is strictly prohibited.', false],
      ['IMPORT_DRAFT', 'Do not run automated scanners.', false],
      ['BACKFILL_DRAFT', 'No automated tools.', false],
    ] as const;
    const ids: string[] = [];
    for (const [reviewState, rules] of cases) {
      const policy = { reviewState, automationAllowed: false, requiredUserAgent: 'Migration/1', requiredHeaders: [],
        exclusions: ['admin.example.test'], requestsPerSecond: null, maxConcurrency: null, forbiddenCategories: ['FUZZING'],
        sourceSnapshot: { url: null, rules, unrepresentedRules: ['Retained documentary rule'] } };
      const program = await p.bountyProgram.create({ data: { ownerId: owner.id, companyName: reviewState, requiredUserAgent: 'Migration/1',
        executionPolicies: { create: { version: 1, policy } },
        campaign: { create: { state: 'BLOCKED', reason: 'Platform rules need review.' } } } });
      ids.push(program.id);
    }
    const sql = (await readFile('prisma/migrations/20261110150000_target_cascade_and_active_policy/migration.sql', 'utf8')).split('-- Append a new active version')[1];
    // Prisma's raw prepared statements accept one statement at a time.
    const statements = ('-- Append a new active version' + sql).split(';').map(s => s.trim()).filter(Boolean);
    for (const statement of statements) await p.$executeRawUnsafe(statement);
    for (const [index, id] of ids.entries()) {
      const program = await p.bountyProgram.findUniqueOrThrow({ where: { id }, include: { ...programPolicyInclude, campaign: true } });
      expect(program.executionPolicies[0]).toMatchObject({ version: 2, policy: { automationAllowed: cases[index][2], exclusions: ['admin.example.test'], forbiddenCategories: ['FUZZING'] } });
      expect(program.executionPolicies[0].policy).not.toHaveProperty('reviewState');
      expect(await p.programExecutionPolicy.findUnique({ where: { programId_version: { programId: id, version: 1 } } })).toMatchObject({ policy: { reviewState: cases[index][0], automationAllowed: false } });
      expect(program.campaign).toMatchObject({ state: 'READY', reason: null });
      expect(campaignPolicyBlocker(program)).toBe(cases[index][2] ? null : 'The program policy does not allow automation.');
    }
    for (const statement of statements) await p.$executeRawUnsafe(statement);
    expect(await p.programExecutionPolicy.count()).toBe(8);
  });
});
