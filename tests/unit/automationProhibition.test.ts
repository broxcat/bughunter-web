import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { automationSourceText, findAutomationProhibition } from '@/lib/automationProhibition.mjs';
import { normalizeIntake, modelExtraction } from '@/server/programImport/intake';
import { normalizeYesWeHack } from '@/server/programImport/intake';
import { resolveProgramPolicy } from '@/server/programExecutionPolicy';
import { automationDenials, automationNonDenials, modelOnlyDenial, reportRestrictions } from '../fixtures/automationProhibition';
const model = modelExtraction.parse({ name: 'Automation fixture', platform: 'PRIVATE', scopeIn: [], scopeOut: [], nonQualifying: [],
  userAgent: null, headers: [], rateLimit: null, maxConcurrency: null, forbidden: [], automationProhibition: null, unresolved: [] });

describe('shared English/French automation prohibition detection', () => {
  it.each(automationDenials)('detects and preserves the source phrase: %s', source => {
    expect(findAutomationProhibition(source)).toBe(source);
    expect(normalizeIntake(source, model).policy).toMatchObject({ automationAllowed: false, automationProhibition: source });
    const ywh = normalizeYesWeHack(source, { name: 'Fixture', sections: { description: source, outOfScope: [], qualifying: [] },
      scopes: [], userAgent: null, nonQualifying: [], rewards: { currency: 'EUR', low: null, medium: null, high: null, critical: null } });
    expect(ywh.policy).toMatchObject({ automationAllowed: false, automationProhibition: source });
  });
  it.each(automationNonDenials)('does not turn a mention into a prohibition: %s', source => {
    expect(findAutomationProhibition(source)).toBeNull();
    expect(normalizeIntake(source, model).policy.automationAllowed).toBe(true);
  });
  it.each(reportRestrictions)('rejects a reporting-only AI quote as testing evidence: %s', source => {
    expect(normalizeIntake(source, { ...model, automationProhibition: source }).policy).toMatchObject({ automationAllowed: true, automationProhibition: null });
    const policy = { ...normalizeIntake(source, model).policy, automationAllowed: false, automationProhibition: source,
      sourceSnapshot: { url: null, rules: source, unrepresentedRules: [] } };
    expect(resolveProgramPolicy({ requiredUserAgent: 'Fixture/1', outOfScope: [], executionPolicies: [{ version: 1, policy }] }).automationBlocked).toBe(false);
  });
  it('still detects a testing ban in another sentence after a reporting rule', () => {
    const text = reportRestrictions[0] + ' No automated scanners';
    expect(findAutomationProhibition(text)).toBe('No automated scanners');
    expect(normalizeIntake(text, { ...model, automationProhibition: reportRestrictions[0] }).policy.automationProhibition).toBe('No automated scanners');
    expect(findAutomationProhibition("Don't use automated tools to prepare reports.")).toBe("Don't use automated tools to prepare reports.");
  });
  it('keeps validated AI evidence ahead of fallback matches and exposes it in the dashboard blocker', () => {
    const source = modelOnlyDenial + '\nNo automated scanners';
    const preview = normalizeIntake(source, { ...model, automationProhibition: modelOnlyDenial });
    expect(preview.policy).toMatchObject({ automationAllowed: false, automationProhibition: modelOnlyDenial });
    const resolved = resolveProgramPolicy({ requiredUserAgent: 'Fixture/1', outOfScope: [],
      executionPolicies: [{ version: 1, policy: { ...preview.policy, sourceSnapshot: { url: null, rules: source, unrepresentedRules: [] } } }] });
    expect(resolved.blocker).toContain('Program rule: ' + modelOnlyDenial);
  });
  it('extracts rule text from historical JSON without returning JSON syntax as the evidence', () => {
    const source = automationSourceText('', { ruleDecisions: [{ text: automationDenials[0] }], legacy: { scopes: [{ rulesOfEngagement: 'Documentary rule' }] } });
    expect(findAutomationProhibition(source)).toBe(automationDenials[0]);
  });
  it('keeps the migration function generated from exactly the runtime rule list', () => {
    expect(() => execFileSync(process.execPath, ['scripts/generate-automation-prohibition.mjs', '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
