import { parseDocument } from 'htmlparser2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { campaignSourceFromIntake, normalizeYesWeHack } from '@/server/programImport/intake';
import { publicProgramText } from '@/server/programImport/publicPage';
import { parseYesWeHackRaw, yesWeHackPageData } from '@/server/programImport/yesWeHack';
import { authorizeExecution, resolveProgramPolicy } from '@/server/programExecutionPolicy';
import { FALLBACK_USER_AGENT } from '@/lib/programExecutionPolicy';

const scopes = [
  { scope: 'https://www.example.test', scope_type: 'web-application', asset_value: 'MEDIUM' },
  { scope: 'https://api.example.test', scope_type: 'api', asset_value: 'CRITICAL' },
  { scope: 'https://site.example.(test|invalid)', scope_type: 'web-application', asset_value: 'LOW' },
  { scope: 'com.example.mobile', scope_type: 'mobile-application-ios', asset_value: 'LOW' },
];
const grid = (bounty_low: number, bounty_medium: number, bounty_high: number, bounty_critical: number) =>
  ({ bounty_low, bounty_medium, bounty_high, bounty_critical });
const raw = `Bug bounty
Public
Submit report1
# Sample storefront
## Reward
Bounty
€100 Low €500 Medium €1,000 High €3,000 Critical
Program description
Keep traffic below 4 requests per second.
## Reward
| Asset value | CVSS Low | CVSS Medium | CVSS High | CVSS Critical |
| Critical | €100 | €500 | €1,000 | €3,000 |
| Medium | €50 | €200 | €500 | €2,000 |
## Scopes
| Scope | Type | Asset value | |
| https://www.example.test | Web application | Medium | |
| https://api.example.test | API | Critical | |
| https://site.example.(test|invalid) | Web application | Low | |
| com.example.mobile | Mobile application (iOS) | Low | |
### Out of scopes
- https://api.example.test/admin/*
- Access to customer records is prohibited.
## Vulnerability types
### Qualifying vulnerabilities
- SQL Injection
- Remote Code Execution
### Non-qualifying vulnerabilities
- Open Redirect
- Missing cosmetic headers
## Hunting requirements
### User agent
Please append to your user-agent header the following value: ' WebBounty-#YesWeHackUserName# '.
## Hunters collaboration`;
const data = {
  slug: 'fixture-storefront', title: 'Sample storefront', public: true, bounty: true, scopes,
  rules: 'Keep traffic below 4 requests per second.', business_unit: { currency: 'EUR' },
  out_of_scope: ['https://api.example.test/admin/*', 'Access to customer records is prohibited.'],
  qualifying_vulnerability: ['SQL Injection', 'Remote Code Execution'],
  non_qualifying_vulnerability: ['Open Redirect', 'Missing cosmetic headers'],
  reward_grid_low: grid(25, 100, 300, 500), reward_grid_medium: grid(50, 200, 500, 2000),
  reward_grid_critical: grid(100, 500, 1000, 3000), reward_grid_high: grid(1000, 5000, 20000, 50000),
  user_agent: 'WebBounty-#YesWeHackUserName#',
};
const html = (program: typeof data) => '<main><h1>Sample storefront</h1><h2>Reward</h2><p>Public program</p></main>' +
  '<script id="ng-state" type="application/json">' + JSON.stringify({ ['getProgram-' + JSON.stringify({ 0: program.slug })]: { data: program } }) + '</script>';
const admit = vi.fn(async () => ({ status: 'ALLOWED' as const, remaining: 1, resetSec: 60 }));
afterEach(() => vi.unstubAllEnvs());

describe('deterministic YesWeHack intake', () => {
  it('uses the official public HTML document and visible asset tiers instead of the unused reward grid', async () => {
    const fetch = vi.fn(async () => new Response(html(data), { headers: { 'Content-Type': 'text/html' } }));
    const page = await publicProgramText('https://yeswehack.com/programs/fixture-storefront?next=http://127.0.0.1', fetch, admit);
    expect(fetch).toHaveBeenCalledWith(new URL('https://yeswehack.com/programs/fixture-storefront'), expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
    expect(page.yesWeHack).toBeTruthy();
    const preview = normalizeYesWeHack(page.text, page.yesWeHack!, page.reference.url);
    expect(preview.rewards).toEqual({ currency: 'EUR', low: 100, medium: 500, high: 1000, critical: 3000 });
    expect(preview.scopeIn).toEqual([
      { value: 'https://www.example.test', type: 'WEB_APPLICATION', assetValue: 'MEDIUM' },
      { value: 'https://api.example.test', type: 'API', assetValue: 'CRITICAL' },
    ]);
    expect(preview.documentedAssets.map(asset => asset.originalValue)).toEqual(['https://site.example.(test|invalid)', 'com.example.mobile']);
    expect(preview.programSections).toMatchObject({ qualifying: ['SQL Injection', 'Remote Code Execution'], outOfScope: data.out_of_scope });
    expect(preview.nonQualifying).toEqual(data.non_qualifying_vulnerability);
    expect(preview.policy).toMatchObject({ userAgentMode: 'APPEND', requiredUserAgent: data.user_agent, requestsPerSecond: 4,
      exclusions: ['https://api.example.test/admin/*'] });
    expect(preview.unresolved).toContain('Access to customer records is prohibited.');
    const campaign = campaignSourceFromIntake(preview)!;
    expect(campaign.sourceDocument).toBe(page.text);
    expect(campaignSourceFromIntake({ ...preview, sourceDocument: page.text + '\nReports today 7' })!.rules).toEqual(campaign.rules);
  });

  it.each([['Markdown', raw], ['plain text', raw.replace(/^#{1,6}\s+/gm, '')], ['tabular clipboard', raw.replace(/^#{1,6}\s+/gm, '')
    .split('\n').map(line => line.startsWith('|') ? line.slice(1, -1).replace(/\s+\|\s+/g, '\t').trim() : line).join('\n')]])(
    'recovers the public program fields from pasted %s', (_kind, input) => {
      const parsed = parseYesWeHackRaw(input);
      expect(parsed).toBeTruthy();
      const preview = normalizeYesWeHack(input, parsed!);
      expect(preview.name).toBe(data.title);
      expect(preview.scopeIn).toHaveLength(2);
      expect(preview.documentedAssets.map(asset => asset.originalValue)).toContain('https://site.example.(test|invalid)');
      expect(preview.rewards).toEqual({ currency: 'EUR', low: 100, medium: 500, high: 1000, critical: 3000 });
      expect(preview.programSections).toEqual({ description: data.rules, outOfScope: data.out_of_scope, qualifying: data.qualifying_vulnerability });
      expect(preview.nonQualifying).toEqual(data.non_qualifying_vulnerability);
      expect(preview.policy).toMatchObject({ userAgentMode: 'APPEND', requiredUserAgent: data.user_agent });
    },
  );

  it('keeps documentary scopes and leaves rewards empty on a disclosure program', () => {
    const program = { ...data, slug: 'fixture-disclosure', bounty: false, scopes: [{ scope: 'https://project.example.test/specification', scope_type: 'other', asset_value: 'LOW' }],
      rules: 'Automated testing is prohibited.', user_agent: '' };
    const parsed = yesWeHackPageData(parseDocument(html(program)), program.slug)!;
    const preview = normalizeYesWeHack('Fixture', parsed);
    expect(preview.scopeIn).toEqual([]);
    expect(preview.documentedAssets).toHaveLength(1);
    expect(preview.rewards).toEqual({ currency: 'EUR', low: null, medium: null, high: null, critical: null });
    expect(preview.policy.automationAllowed).toBe(false);
    expect(preview.policy.requiredUserAgent).toBeNull();
  });

  it('handles exact instructions, suffixes, and YesWeHack username templates at execution', () => {
    const exact = normalizeYesWeHack(raw, parseYesWeHackRaw(raw.replace('Keep traffic below 4 requests per second.',
      'Your **User-Agent** header must be set to `WebBounty-#YesWeHackUserName#` for all your requests.'))!);
    expect(exact.policy).not.toHaveProperty('userAgentMode');
    const program = { outOfScope: [], requiredUserAgent: '', executionPolicies: [{ version: 1, policy: {
      ...exact.policy, userAgentMode: 'APPEND', requiredUserAgent: 'Bounty-<your yeswehack pseudo>',
      sourceSnapshot: { url: null, rules: '', unrepresentedRules: [] },
    } }] };
    vi.stubEnv('DEFAULT_USER_AGENT', '');
    vi.stubEnv('HUNTER_USERNAME', 'fixture-hunter');
    // APPEND mode with no DEFAULT_USER_AGENT falls back instead of blocking.
    expect(resolveProgramPolicy(program).userAgent).toBe(FALLBACK_USER_AGENT);
    vi.stubEnv('DEFAULT_USER_AGENT', 'DefaultAgent/1');
    vi.stubEnv('HUNTER_USERNAME', '');
    const unresolved = resolveProgramPolicy(program);
    expect(unresolved.userAgent).toBe(FALLBACK_USER_AGENT);
    expect(() => authorizeExecution({ host: 'example.test', policy: unresolved }, { tool: 'http-probe' })).not.toThrow();
    vi.stubEnv('HUNTER_USERNAME', 'fixture-hunter');
    expect(resolveProgramPolicy(program)).toMatchObject({ userAgent: 'DefaultAgent/1 Bounty-fixture-hunter' });
  });

  it('rejects private data and never downloads an unrecognized URL', async () => {
    expect(yesWeHackPageData(parseDocument(html({ ...data, public: false })), data.slug)).toBeNull();
    const fetch = vi.fn();
    await expect(publicProgramText('https://yeswehack.com.attacker.test/programs/fixture-storefront', fetch, admit)).rejects.toThrow('does not match');
    expect(fetch).not.toHaveBeenCalled();
  });
});
