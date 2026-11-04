import { assetAllowsUrl, scopeAssetExecutable, type AssetBoundary } from './scopeAssets';
import { isExcluded } from './bountyProgram';
import { buildCapabilityPlans, type ReconCapabilityPlan } from './reconCapabilities';
import { isSafeReadUrl } from './observationSafety';

export type ReconTool = 'subfinder' | 'amass' | 'assetfinder' | 'httpx' | 'nmap' | 'ffuf' | 'gobuster' | 'nuclei' | 'burp' | 'internal';
export type ReconDepth = 'LIGHT' | 'STANDARD' | 'DEEP';
export const RECON_CAPACITY = { globalAssets: 2, perTarget: 1, maxHttpRps: 6, processesPerTool: 1 } as const;
export const RECON_BUDGETS = {
  LOW: { depth: 'LIGHT', maxDurationMs: 180000, rps: 1, maxRequests: 60, maxHosts: 4, enrichHosts: 1, ffufSeconds: 15, ffufDepth: 0, words: 6, ports: [80,443], templates: 1, passiveSeconds: 20, crawlPages: 3 },
  MEDIUM: { depth: 'STANDARD', maxDurationMs: 600000, rps: 2, maxRequests: 240, maxHosts: 12, enrichHosts: 3, ffufSeconds: 30, ffufDepth: 1, words: 12, ports: [80,443,8080,8443], templates: 2, passiveSeconds: 45, crawlPages: 8 },
  HIGH: { depth: 'DEEP', maxDurationMs: 1200000, rps: 2, maxRequests: 600, maxHosts: 24, enrichHosts: 5, ffufSeconds: 60, ffufDepth: 2, words: 20, ports: [21,22,25,53,80,443,3000,5000,8000,8080,8443,9000], templates: 3, passiveSeconds: 90, crawlPages: 15 },
  CRITICAL: { depth: 'DEEP', maxDurationMs: 1800000, rps: 3, maxRequests: 1200, maxHosts: 40, enrichHosts: 8, ffufSeconds: 90, ffufDepth: 3, words: 30, ports: [21,22,25,53,80,110,143,443,445,587,993,995,1433,3000,3306,5000,5432,6379,8000,8080,8443,9000,9200], templates: 4, passiveSeconds: 120, crawlPages: 25 },
} as const;
export const RECON_STAGE_NAMES = ['Preflight', 'Passive discovery', 'Scope validation / DNS', 'HTTP surface', 'Host prioritization', 'Ports / services', 'Content discovery', 'Web / API mapping', 'Nuclei Recon', 'Burp enrichment', 'Normalization', 'Scope intelligence'] as const;
export const RECON_AUTH_MAPPING_BUDGETS = {
  LOW: { maxRequests:16,maxPagesPerContext:3,maxDepth:1,maxDurationMs:30000 },
  MEDIUM: { maxRequests:48,maxPagesPerContext:8,maxDepth:2,maxDurationMs:60000 },
  HIGH: { maxRequests:96,maxPagesPerContext:12,maxDepth:2,maxDurationMs:90000 },
  CRITICAL: { maxRequests:160,maxPagesPerContext:20,maxDepth:3,maxDurationMs:120000 },
} as const;
export type ReconStagePlan = { name: typeof RECON_STAGE_NAMES[number]; tools: ReconTool[]; mode: 'PASSIVE' | 'ACTIVE'; enabled: boolean; reason: string };
export type ReconPlan = {
  /** Optional for historical v2 plans stored before methodology v2. */
  methodologyVersion?: 2; strategy?: 'WIDE' | 'DEEP'; capabilities?: ReconCapabilityPlan[];
  authenticatedMapping?: { maxContexts:number;maxRequests:number;maxPagesPerContext:number;maxDepth:number;maxDurationMs:number;browserRequestsPerContext:number;browserPages:number };
  version: 2; scopeAssetId: string; format: string; type: string; assetValue: keyof typeof RECON_BUDGETS;
  activityMode: 'PASSIVE' | 'ACTIVE'; depth: ReconDepth; boundary: AssetBoundary;
  stages: ReconStagePlan[]; limits: { maxDurationMs: number; rps: number; maxRequests: number; maxHosts: number; enrichHosts: number; ffufSeconds: number; ffufDepth: number; words: number; ports: readonly number[]; templates: number; passiveSeconds: number; crawlPages: number; maxConcurrency: number }; rationale: string[];
  gobuster?: {dir:boolean;dns:boolean;vhost:false;seconds:number;words:number;reason:string};
  ffufProfile: string; authorization: { active: boolean; exclusions: string[] };
};
export function buildReconPlan(asset: { id: string; normalizedValue: string; format: string; type: string; assetValue: string; active: boolean }, authorization: { active: boolean; exclusions: string[] }, context: {newSurface?:boolean;authenticatedContexts?:number} = {}): ReconPlan {
  const value = Object.hasOwn(RECON_BUDGETS, asset.assetValue) ? asset.assetValue as keyof typeof RECON_BUDGETS : 'MEDIUM';
  const budget = RECON_BUDGETS[value], wildcard = asset.format === 'WILDCARD_DOMAIN';
  const strategy = wildcard || context.newSurface ? 'WIDE' : 'DEEP';
  const executable = scopeAssetExecutable(asset);
  const active = asset.active && authorization.active && executable && (asset.format!=='URL'||isSafeReadUrl(asset.normalizedValue));
  const httpOnly = asset.format === 'URL', api = asset.type === 'API';
  const limits = { ...budget, maxConcurrency: 1, maxHosts: wildcard ? budget.maxHosts : 1, enrichHosts: wildcard ? budget.enrichHosts : 1,
    maxDurationMs: wildcard ? budget.maxDurationMs : Math.min(budget.maxDurationMs, httpOnly ? 600000 : 900000),
    maxRequests: wildcard ? budget.maxRequests : Math.min(budget.maxRequests, httpOnly ? 300 : 600),
    ports: httpOnly ? [] : api || asset.type === 'WEB_APPLICATION' ? budget.ports.filter(p => [80,443,3000,5000,8000,8080,8443,9000].includes(p)) : [...budget.ports] };
  const gobuster={dir:active && (asset.type==='WEB_APPLICATION'||api&&budget.depth!=='LIGHT'||httpOnly&&!api),dns:active&&wildcard&&budget.depth==='DEEP',vhost:false as const,seconds:Math.min(30,budget.ffufSeconds),words:budget.depth==='LIGHT'?6:budget.depth==='STANDARD'?4:8,reason:'Dir uses disjoint bounded words behind the HTTP scope relay; DNS only for explicitly authorized DEEP wildcard descendants. Vhost disabled: exact hosts do not authorize other virtual hosts.'};
  const stages = RECON_STAGE_NAMES.map(name => {
    const passive = ['Preflight', 'Passive discovery', 'Host prioritization', 'Burp enrichment', 'Normalization', 'Scope intelligence'].includes(name);
    const enabled = name === 'Passive discovery' ? wildcard && asset.active : name === 'Ports / services' ? active && !httpOnly : passive || active;
    const tools: ReconTool[] = name === 'Passive discovery' ? ['subfinder','amass','assetfinder'] : name === 'HTTP surface' ? ['httpx'] : name === 'Ports / services' ? ['nmap'] : name === 'Content discovery' ? [...(gobuster.dir&&budget.depth==='LIGHT'?[]:['ffuf' as const]),...(gobuster.dir?['gobuster' as const]:[])] : name === 'Scope validation / DNS'&&gobuster.dns ? ['internal','gobuster'] : name === 'Nuclei Recon' ? ['nuclei'] : name === 'Burp enrichment' ? ['burp'] : ['internal'];
    return { name, tools, mode: passive ? 'PASSIVE' as const : 'ACTIVE' as const, enabled,
      reason: !enabled ? httpOnly && name === 'Ports / services' ? 'URL authorization does not grant host-wide port discovery.' : !active ? 'Effective authorization does not permit active target traffic.' : 'Exact host/URL: no parent-domain enumeration.' : name === 'Burp enrichment' ? 'Read existing, authorized history only; never start an agent.' : `${budget.depth} ${api ? 'API' : asset.type} collection within the immutable asset boundary.` };
  });
  const capabilities=buildCapabilityPlans({wildcard,active,assetActive:asset.active,httpOnly,type:asset.type,depth:budget.depth,gobusterDir:gobuster.dir,gobusterDns:gobuster.dns,authenticatedContexts:context.authenticatedContexts});
  return { version: 2, methodologyVersion:2,strategy,capabilities,scopeAssetId: asset.id, format: asset.format, type: asset.type, assetValue: value, activityMode: active ? 'ACTIVE' : 'PASSIVE', depth: budget.depth,
    boundary: { normalizedValue: asset.normalizedValue, format: asset.format, active: asset.active }, authorization, limits, stages,
    gobuster, ffufProfile: `${api ? 'API' : 'WEB'}_${budget.depth}`,
    authenticatedMapping:{...RECON_AUTH_MAPPING_BUDGETS[value],maxContexts:4,browserRequestsPerContext:4,browserPages:1},
    rationale: [`${strategy==='WIDE'?'WIDE surface mapping before selected-host enrichment':'DEEP focused mapping inside the exact host/origin/path'}; activity mode remains independent of depth.`,`${asset.format} selects ${wildcard ? 'multi-source passive discovery, validation, then progressive enrichment' : 'the exact selected host/origin/path; no scope expansion'}.`, `${asset.type} selects ${api ? 'API documentation and route' : 'web/service'} enrichment.`, `${value} selects ${budget.depth} depth and a bounded ${limits.maxDurationMs} ms / ${limits.maxRequests} request budget.`, 'Asset value changes budget and priority, never authorization. Active target traffic and depth are separate decisions.'] } as ReconPlan;
}
export function reconUrlAllowed(plan: ReconPlan, url: string) { try{return plan.activityMode === 'ACTIVE' && !isExcluded(new URL(url).hostname,plan.authorization.exclusions) && assetAllowsUrl(plan.boundary, url);}catch{return false;} }
export function rankReconHost(host: string, facts: { alive?: boolean; auth?: boolean; api?: boolean; admin?: boolean; technology?: boolean; unusualPort?: boolean; changed?: boolean } = {}) {
  const signals = Object.entries(facts).filter(([,v]) => v).map(([k]) => k);
  if (/(^|\.)(api|admin|auth|portal|dev|staging|account)(\.|-)/i.test(host)) signals.push('hostname');
  const weights: Record<string, number> = { alive: 50, auth: 25, api: 20, admin: 20, technology: 5, unusualPort: 10, changed: 10, hostname: 15 };
  return { host, score: signals.reduce((n,s) => n + weights[s], 0), signals: signals.sort() };
}
