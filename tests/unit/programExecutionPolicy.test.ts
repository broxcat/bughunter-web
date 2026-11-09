
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executionPolicySchema, MISSING_HUNTER_UA, type ExecutionPolicyInput } from '@/lib/programExecutionPolicy';
import { authorizeExecution, excludedByPolicy, resolveProgramPolicy } from '@/server/programExecutionPolicy';
import { executionHeaders, withTargetExecution } from '@/server/execution';

const config: ExecutionPolicyInput = {
  automationAllowed: true,
  requiredUserAgent: null,
  requiredHeaders: [{ name: 'X-Bug-Bounty', value: 'program' }],
  exclusions: ['https://example.com/admin/*'],
  requestsPerSecond: 2,
  maxConcurrency: 1,
  forbiddenCategories: ['FUZZING'],
  sourceSnapshot: { url: null, rules: '', unrepresentedRules: [] },
};
const legacy = { requiredUserAgent: 'Legacy/1', outOfScope: [] };
const resolve = (policy = config) => resolveProgramPolicy({ ...legacy, executionPolicies: [{ version: 1, policy }] });
beforeEach(() => vi.stubEnv('DEFAULT_USER_AGENT', 'Hunter/1'));
afterEach(() => vi.unstubAllEnvs());

describe('program execution policy', () => {
  it('denies an excluded URL prefix without excluding a sibling path', () => {
    const ctx = { host: 'example.com', policy: resolve() };
    expect(() => authorizeExecution(ctx, { tool: 'http-probe', url: 'https://example.com/admin/x' })).toThrow('out of scope');
    expect(() => authorizeExecution(ctx, { tool: 'http-probe', url: 'https://example.com/app' })).not.toThrow();
    expect(() => authorizeExecution(ctx, { tool: 'http-probe', url: 'https://example.com/%61dmin/x' })).toThrow('Ambiguous');
  });

  it('applies wildcard, IP and CIDR exclusions, including IPv6', () => {
    const policy = resolve({ ...config, exclusions: ['*.private.example.com', '192.0.2.7', '198.51.100.0/24', '2001:db8::/48'] });
    for (const host of ['a.private.example.com', '192.0.2.7', '198.51.100.42', '[2001:db8::42]']) expect(excludedByPolicy(policy, host)).toBe(true);
    expect(excludedByPolicy(policy, '198.51.101.42')).toBe(false);
    expect(excludedByPolicy(resolve({ ...config, exclusions: ['*.private.example.com'] }), 'private.example.com')).toBe(false);
  });

  it('blocks forbidden and unknown tools before execution', () => {
    const ctx = { host: 'example.com', policy: resolve() };
    for (const tool of ['ffuf', 'nuclei', 'gobuster-dns', 'content-discovery', 'research-http', 'research-browser']) {
      expect(() => authorizeExecution(ctx, { tool })).toThrow('Test category forbidden');
    }
    for (const tool of ['unmapped-tool', 'constructor']) expect(() => authorizeExecution(ctx, { tool })).toThrow('Unclassified');
    expect(() => authorizeExecution(ctx, { tool: 'httpx' })).not.toThrow();
  });

  it('resolves the program, environment default and explicit missing-UA cases in order', () => {
    expect(resolve({ ...config, requiredUserAgent: 'Program/1' }).userAgent).toBe('Program/1');
    expect(resolve().userAgent).toBe('Hunter/1');
    expect(resolveProgramPolicy(legacy).userAgent).toBe('Legacy/1');
    vi.stubEnv('DEFAULT_USER_AGENT', '');
    expect(resolveProgramPolicy({ ...legacy, requiredUserAgent: '' }).blocker).toBe(MISSING_HUNTER_UA);
  });

  it('enforces case-insensitive required headers after user-supplied headers', () => {
    const policy = resolve();
    const headers = withTargetExecution({ policy, targetId: 'target', host: 'example.com', requiredUserAgent: policy.userAgent, qualifying: [], nonQualifying: [] },
      () => executionHeaders({ 'X-Bug-Bounty': 'wrong', 'User-Agent': 'wrong' }));
    expect(Object.fromEntries(headers)).toEqual({ 'user-agent': 'Hunter/1', 'x-bug-bounty': 'program' });
    expect(executionPolicySchema.safeParse({ ...config, requiredHeaders: [{ name: 'Host', value: 'other.example.com' }] }).success).toBe(false);
  });

  it('denies disabled, unrepresented and stale rules', () => {
    for (const policy of [
      resolve({ ...config, automationAllowed: false }),
      resolve({ ...config, sourceSnapshot: { ...config.sourceSnapshot, unrepresentedRules: ['Special window'] } }),
      resolveProgramPolicy({ ...legacy, rulesOfEngagement: 'Changed', executionPolicies: [{ version: 1, policy: config }] }),
      resolveProgramPolicy({ ...legacy, rulesOfEngagement: 'Free text' }),
    ]) expect(() => authorizeExecution({ host: 'example.com', policy }, { tool: 'browser' })).toThrow(/automation/i);
  });
});
