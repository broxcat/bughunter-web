import { automationDenials, automationNonDenials, modelOnlyDenial } from '../fixtures/automationProhibition';
import { findAutomationProhibition } from '@/lib/automationProhibition.mjs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const db = process.env.TEST_DATABASE_URL;
const schema = 'active_policy_' + randomUUID().replaceAll('-', '');
describe.skipIf(!db)('draft policy activation migration', () => {
  let p: PrismaClient;
  let campaignPolicyBlocker: typeof import('@/server/campaignOrchestrator').campaignPolicyBlocker;
  let programPolicyInclude: typeof import('@/server/programExecutionPolicy').programPolicyInclude;
  beforeAll(async () => {
    const url = new URL(db!); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.href;
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma: p } = await import('@/lib/prisma'));
    ({ campaignPolicyBlocker } = await import('@/server/campaignOrchestrator'));
    ({ programPolicyInclude } = await import('@/server/programExecutionPolicy'));
  }, 60000);
  afterAll(async () => { if (p) { await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await p.$disconnect(); } });
  it('uses the same expression and returns the same evidence as intake, for every English/French fixture', async () => {
    for (const source of [...automationDenials, ...automationNonDenials]) {
      const [result] = await p.$queryRaw<{ evidence: string | null }[]>`SELECT program_automation_prohibition(${source}) AS evidence`;
      expect(result.evidence).toBe(findAutomationProhibition(source));
    }
    const snapshot = { ruleDecisions: [{ text: automationDenials[0] }], sourceDocument: modelOnlyDenial };
    const [result] = await p.$queryRaw<{ evidence: string | null }[]>`SELECT program_automation_prohibition(program_automation_source('', ${JSON.stringify(snapshot)}::jsonb)) AS evidence`;
    expect(result.evidence).toBe(automationDenials[0]);
  });
  it('appends active versions, preserves explicit bans and history, and releases review campaigns once', async () => {
    const owner = await p.user.create({ data: { email: randomUUID() + '@example.test' } });
    const cases = [
      ['BACKFILL_DRAFT', 'Identify yourself. Special testing window.', true],
      ['IMPORT_DRAFT', 'Automation is strictly prohibited.', false],
      ['IMPORT_DRAFT', 'Do not run automated scanners.', false],
      ['BACKFILL_DRAFT', 'No automated tools.', false],
      ...automationDenials.map(rules => ['IMPORT_DRAFT', rules, false] as const),
      ...automationNonDenials.map(rules => ['BACKFILL_DRAFT', rules, true] as const),
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
      expect(campaignPolicyBlocker(program)).toBe(cases[index][2] ? null : 'The program policy does not allow automation. Program rule: ' + cases[index][1]);
      expect(program.executionPolicies[0].policy).toMatchObject({ automationProhibition: cases[index][2] ? null : cases[index][1] });
    }
    for (const statement of statements) await p.$executeRawUnsafe(statement);
    expect(await p.programExecutionPolicy.count({ where: { programId: { in: ids } } })).toBe(cases.length * 2);
  });
});
