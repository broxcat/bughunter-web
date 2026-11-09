
import { BlockList, isIP } from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { requiredUserAgentSchema } from '@/lib/httpPolicy.mjs';
import { isExcluded, matchesHost } from '@/lib/bountyProgram';
import { assetAllowsHost, assetAllowsUrl, detectScopeAsset, type AssetBoundary } from '@/lib/scopeAssets';
import { storedExecutionPolicySchema, hunterIdentitySchema, LEGACY_LIMITS, MISSING_HUNTER_UA, type TestCategory } from '@/lib/programExecutionPolicy';

import { captureLegacyScopes, legacyExclusionParity, legacyScopeFingerprint, legacyScopeTargets } from './legacyPolicySource';

export const currentPolicySelection = { orderBy: { version: 'desc' as const }, take: 1 };
export const programPolicyInclude = {
  executionPolicies: currentPolicySelection,
  targets: legacyScopeTargets,
  owner: { select: { hunterIdentity: { select: { userAgent: true, headers: true } } } },
};
export type PolicyProgram = {
  ownerId?: string;
  requiredUserAgent: string;
  outOfScope: readonly string[];
  programUrl?: string | null;
  rulesOfEngagement?: string | null;
  executionPolicies?: readonly { version: number; policy: unknown }[];
  targets?: readonly { scope: { id: string; userId: string; scopeDetails: string | null; outOfScope: string | null; rulesOfEngagement: string | null } }[];
  owner?: { hunterIdentity: { userAgent: string | null; headers: unknown } | null };
};
type ScopeRules = { scopeDetails?: string | null; outOfScope?: string | null; rulesOfEngagement?: string | null };

export function resolveProgramPolicy(program: PolicyProgram, scope?: ScopeRules) {
  const row = program.executionPolicies?.[0];
  const policy = row && storedExecutionPolicySchema.parse(row.policy);
  const identity = program.owner?.hunterIdentity && hunterIdentitySchema.parse(program.owner.hunterIdentity);
  const userAgent = (policy ? policy.requiredUserAgent : program.requiredUserAgent) || identity?.userAgent || '';
  const headers = Object.fromEntries([...(identity?.headers ?? []), ...(policy ? policy.requiredHeaders : [])].map(({ name, value }) => [name, value]));
  const sourceMismatch = policy && (policy.sourceSnapshot.rules !== (program.rulesOfEngagement?.trim() ?? '') ||
    policy.sourceSnapshot.url !== (program.programUrl ?? null));
  const captured = policy?.sourceSnapshot.legacy;
  const scopes = program.targets && captureLegacyScopes(program.targets.map(target => target.scope), program.ownerId);
  const hasScopeProse = scopes ? scopes.length > 0 : Boolean(scope?.scopeDetails?.trim() || scope?.outOfScope?.trim() || scope?.rulesOfEngagement?.trim());
  const reviewedScope = Boolean(policy?.reviewState === 'OWNER_REVIEWED' && captured && scopes &&
    legacyScopeFingerprint(captured.scopes) === legacyScopeFingerprint(scopes));
  const legacyChanged = captured && (!isDeepStrictEqual(captured.outOfScope, program.outOfScope) ||
    captured.programRules !== (program.rulesOfEngagement ?? null));
  const parity = captured && policy?.automationAllowed ? legacyExclusionParity(program.outOfScope, policy.exclusions) : null;
  const unrepresented = sourceMismatch || legacyChanged || (hasScopeProse && !reviewedScope) ||
    Boolean(captured?.scopes.length && !reviewedScope) || Boolean(parity && (parity.missing.length || parity.unconvertible.length)) ||
    (policy ? policy.sourceSnapshot.unrepresentedRules.length > 0 : Boolean(program.rulesOfEngagement?.trim()));
  const blocker = policy?.reviewState === 'BACKFILL_DRAFT' ? 'Automation is blocked until you review and save the imported policy in Target settings.'
    : unrepresented ? 'Automation is blocked by unrepresented program or scope rules. Review the execution policy in Target settings.'
    : policy && !policy.automationAllowed ? 'Automation is disabled in Target settings.'
    : !requiredUserAgentSchema.safeParse(userAgent).success || userAgent !== userAgent.trim() || /\\[rn]/.test(userAgent) ? MISSING_HUNTER_UA
    : null;
  const exclusions = (policy ? policy.exclusions : []).map(value => detectScopeAsset(value));
  const limits = { requestsPerSecond: policy?.requestsPerSecond ?? LEGACY_LIMITS.requestsPerSecond, maxConcurrency: policy?.maxConcurrency ?? LEGACY_LIMITS.maxConcurrency };
  const forbiddenCategories = policy ? policy.forbiddenCategories : [];
  const version = row?.version ?? 0;
  const fingerprint = createHash('sha256').update(JSON.stringify([version, blocker, headers, userAgent, program.outOfScope, exclusions, limits, forbiddenCategories])).digest('hex');
  return { version, userAgent, headers, reviewedScope, exclusions, legacyExclusions: program.outOfScope, limits, forbiddenCategories, blocker, fingerprint };
}
export function programPolicyBlocker(program: PolicyProgram, scope?: ScopeRules) {
  try { return resolveProgramPolicy(program, scope).blocker; }
  catch { return 'Invalid program execution policy'; }
}

export type ResolvedProgramPolicy = ReturnType<typeof resolveProgramPolicy>;

const allHttpTests: readonly TestCategory[] = [
  'ACTIVE_SCANNING', 'CRAWLING', 'FUZZING', 'BRUTE_FORCE', 'DENIAL_OF_SERVICE', 'AUTHENTICATED_TESTING',
];
const toolCategories: Record<string, readonly TestCategory[]> = {
  subfinder: ['PASSIVE_RECON'], amass: ['PASSIVE_RECON'], assetfinder: ['PASSIVE_RECON'],
  gau: ['PASSIVE_RECON'], 'certificate-transparency': ['PASSIVE_RECON'],
  'native-dns': ['DNS_LOOKUP'], 'dns-fuzz': ['DNS_LOOKUP', 'FUZZING', 'BRUTE_FORCE'],
  'guarded-tcp': ['PORT_SCAN', 'ACTIVE_SCANNING'],
  'native-tls': ['ACTIVE_SCANNING'], nmap: ['PORT_SCAN', 'ACTIVE_SCANNING'],
  httpx: ['ACTIVE_SCANNING'], katana: ['ACTIVE_SCANNING', 'CRAWLING'],
  nuclei: ['ACTIVE_SCANNING', 'FUZZING'], dalfox: ['ACTIVE_SCANNING', 'FUZZING'],
  ffuf: ['ACTIVE_SCANNING', 'FUZZING', 'BRUTE_FORCE'],
  'gobuster-dir': ['ACTIVE_SCANNING', 'FUZZING', 'BRUTE_FORCE'],
  'gobuster-dns': ['DNS_LOOKUP', 'FUZZING', 'BRUTE_FORCE'],
  'burp-history': ['PASSIVE_RECON'],
  'http-probe': ['ACTIVE_SCANNING'], 'http-crawl': ['ACTIVE_SCANNING', 'CRAWLING'],
  'content-discovery': ['ACTIVE_SCANNING', 'FUZZING', 'BRUTE_FORCE'],
  'authenticated-probe': ['ACTIVE_SCANNING', 'AUTHENTICATED_TESTING'],
  browser: ['ACTIVE_SCANNING', 'BROWSER', 'CRAWLING', 'AUTHENTICATED_TESTING'],
  'research-browser': [...allHttpTests, 'BROWSER'],
  'research-http': allHttpTests,
};

export function excludedByPolicy(policy: ResolvedProgramPolicy, host: string, url?: URL) {
  const canonicalHost = host.toLowerCase().replace(/^\[|\]$|\.$/g, '');
  if (isExcluded(canonicalHost, policy.legacyExclusions)) return true;
  return policy.exclusions.some(exclusion => {
    if (exclusion.format === 'URL') {
      if (!url) return false;
      const boundary = new URL(exclusion.normalizedValue);
      const prefix = boundary.pathname.toLowerCase().replace(/\/\*$/, '/').replace(/\/$/, '');
      return boundary.origin === url.origin && (!prefix || url.pathname.toLowerCase() === prefix || url.pathname.toLowerCase().startsWith(prefix + '/'));
    }
    if (exclusion.format === 'IP' || exclusion.format === 'CIDR') {
      const family = isIP(canonicalHost);
      // A hostname transport without DNS pinning cannot prove that its peer
      // is outside an excluded IP range. Keep that traffic disabled.
      if (!family) return true;
      const [address, bits] = exclusion.normalizedValue.split('/');
      const subnetFamily = isIP(address) === 6 ? 'ipv6' : 'ipv4';
      const subnet = new BlockList();
      subnet.addSubnet(address, bits === undefined ? (subnetFamily === 'ipv6' ? 128 : 32) : Number(bits), subnetFamily);
      return subnet.check(canonicalHost, family === 6 ? 'ipv6' : 'ipv4');
    }
    return matchesHost(canonicalHost, exclusion.normalizedValue);
  });
}

export type ExecutionBoundary = {
  host: string;
  scopeAsset?: AssetBoundary;
  parentScopeAsset?: AssetBoundary;
  policy?: ResolvedProgramPolicy;
};

/** The same decision is used at every target network boundary. */
export function authorizeExecution(ctx: ExecutionBoundary, activity: { tool?: string; url?: string; dnsHost?: string }) {
  const { tool, url, dnsHost } = activity;
  const policy = ctx.policy;
  if (policy?.blocker) throw new Error(policy.blocker);
  if (tool !== undefined) {
    const categories = Object.hasOwn(toolCategories, tool) ? toolCategories[tool] : undefined;
    if (!categories) throw new Error('Unclassified execution tool');
    if (categories.some(category => policy?.forbiddenCategories.includes(category))) throw new Error('Test category forbidden by the program');
  }
  if (url) {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password ||
        parsed.host.toLowerCase() !== ctx.host.toLowerCase() || /[\\\x00-\x20\x7f]/.test(url) ||
        /%2e|%2f|%5c|%25/i.test(url.split(/[?#]/)[0])) throw new Error('URL is outside the selected active Scope host');
    if (ctx.scopeAsset && !assetAllowsUrl(ctx.scopeAsset, url)) throw new Error('URL is outside the selected Scope Asset boundary');
    if (ctx.parentScopeAsset && !assetAllowsUrl(ctx.parentScopeAsset, url)) throw new Error('URL is outside the parent Scope Asset boundary');
    // Reject encoded/ambiguous path spellings when path exclusions matter.
    if (policy?.exclusions.some(e => e.format === 'URL' && new URL(e.normalizedValue).origin === parsed.origin) &&
        (/%|;|\/\//.test(parsed.pathname) || /\/\.{1,2}(?:\/|[?#]|$)/.test(url))) throw new Error('Ambiguous request path under a structured exclusion');
    if (policy && excludedByPolicy(policy, parsed.hostname, parsed)) throw new Error('URL is explicitly out of scope');
  }
  if (dnsHost) {
    const boundary = ctx.scopeAsset ?? ctx.parentScopeAsset;
    if ((boundary ? !assetAllowsHost(boundary, dnsHost) : dnsHost !== ctx.host) ||
        (policy && excludedByPolicy(policy, dnsHost))) throw new Error('DNS host is outside the selected Scope boundary');
  }
}
