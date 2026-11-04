import { deriveAssetGraph } from '@/lib/reconGraph';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { persistedCorpusSchema } from '@/server/recon/corpus';
import { safeObservationUrl, isSafeReadUrl } from '@/lib/observationSafety';
import { normalizeFqdn } from '@/lib/bountyProgram';
import type { ReconEvidence, ResearchReconContext } from '@/lib/research/recon';
import { assetAllowsHost, assetAllowsUrl, assetValueRank } from '@/lib/scopeAssets';
import type { AssetEvidence } from '@/server/recon/assetEvidence';
import type { ReconArtifactData } from '@/lib/reconArtifacts';
import { assessmentSnapshotFromRun, type AssessmentSnapshot, type AssessmentMode } from '@/lib/assessment';

export const RECON_DETAIL_BYTES = 1024 * 1024;
export const RECON_SUMMARY_BYTES = 24 * 1024;
export const RECON_INPUT_LIMITS = { scans: 60, discoveries: 500, logs: 1000 } as const;
export type ReconRun = {
  assessmentModeSnapshot?: AssessmentMode | null; assessmentSourcesSnapshot?: unknown;
  artifacts?: ReconArtifactData[];
  artifactInputTruncated?: boolean;
  partialCoverage?: boolean;
  historicalUrls?: string[];
  corpusReference?: string; httpObservations?: AssetEvidence['hosts'][number]['http']; dnsAddresses?: string[]; portObservations?: AssetEvidence['hosts'][number]['ports']; tlsObservation?: AssetEvidence['hosts'][number]['tls'];
  id: string; targetId: string; status: string; outcome: string | null; createdAt: Date; startedAt: Date | null; finishedAt: Date | null;
  reconCorpus: unknown; target: { host: string };
  discoveries: Array<{ id: string; host: string; source: string; state: string; createdAt: Date }>;
  logs: Array<{ id: string; line: string; stream: string; createdAt: Date }>;
  _count?: { discoveries: number; logs: number };
};
export const reconHash = (value: string) => createHash('sha256').update(value).digest('hex');
// PostgreSQL JSONB may reorder keys. Canonical encoding survives a DB round trip.
export const reconJson = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item, 2) + '\n';
const sorted = (values: string[]) => [...new Set(values)].sort();
const cleanParameter = (v: string) => /^[a-z_][a-z0-9_.[\]-]{0,63}$/i.test(v);
const iso = (v: Date) => v.toISOString();
export function reconFreshness(lastSeenAt: string, asOf: string) {
  const age = Date.parse(asOf) - Date.parse(lastSeenAt);
  return age > 30 * 86400000 ? 'STALE' as const : age > 7 * 86400000 ? 'AGING' as const : 'RECENT' as const;
}
/** Values are never rendered into prompts, Markdown, configs, commands or system instructions. */
function observedUrl(value: string) {
  if (value.length > 2048 || /[\x00-\x20\x7f\\]/.test(value)) return null;
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    normalizeFqdn(u.hostname);
    const safe = new URL(safeObservationUrl(value));
    const parameters = sorted([...safe.searchParams.keys()].filter(cleanParameter));
    // Parameter values are not required to identify a surface and may contain secrets/instructions.
    safe.search = ''; safe.hash = '';
    return { url: safe.toString(), parameters };
  } catch { return null; }
}
export function buildReconContext(input: {
  programId: string; scopeId: string; targetId: string; generatedAt: string; runs: ReconRun[];
  inScope: (value: string) => boolean; activeSuggestionsAllowed: boolean; warnings?: string[];
  scopeAssets?: ResearchReconContext['scopeAssets'];
  assessmentSnapshot?: AssessmentSnapshot;
}): ResearchReconContext {
  const warnings = new Set(input.warnings ?? []);
  const context: ResearchReconContext = { schemaVersion: 1, programId: input.programId, scopeId: input.scopeId, targetId: input.targetId,
    ...(input.scopeAssets ? { scopeAssets: [...input.scopeAssets].sort((a, b) => assetValueRank(a.assetValue) - assetValueRank(b.assetValue) || a.id.localeCompare(b.id)) } : {}),
    generatedAt: input.generatedAt, untrustedData: true, authorizationGranted: false, activeSuggestionsAllowed: input.activeSuggestionsAllowed,
    sources: [], assets: [], endpoints: [], technologies: [], observations: [], suggestions: [], warnings: [],
    counts: { assets: 0, endpoints: 0, technologies: 0, observations: 0, sources: 0, suggestions: 0 }, truncated: false };
  const maps = { assets: new Map<string, typeof context.assets[number]>(), endpoints: new Map<string, typeof context.endpoints[number]>(),
    technologies: new Map<string, typeof context.technologies[number]>(), observations: new Map<string, typeof context.observations[number]>() };
  const runs = [...input.runs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const assessment = input.assessmentSnapshot ?? assessmentSnapshotFromRun(runs.at(-1));
  context.assessment = { assessmentMode: assessment.assessmentMode, authorizedSourceCount: assessment.authorizedSources.length, sourceContentAvailable: false, sourceAnalysisPerformed: false, assessmentPolicyFile: assessment.assessmentMode ? 'assessment-policy.json' : null };
  const latest = new Map<string, string>();
  const latestTime = new Map<string, string>();
  const previousCompleted = new Map<string, string>();
  const endpointRuns = new Map<string, Set<string>>();
  for (const run of runs) if (run.status === 'COMPLETED' && (run.artifacts || persistedCorpusSchema.safeParse(run.reconCorpus).success)) {
    if (latest.has(run.targetId) && latest.get(run.targetId) !== run.id) previousCompleted.set(run.targetId, latest.get(run.targetId)!);
    latest.set(run.targetId, run.id);
    const capturedAt = run.artifacts ? run.finishedAt ?? run.createdAt : new Date(persistedCorpusSchema.parse(run.reconCorpus).capturedAt);
    latestTime.set(run.targetId, iso(capturedAt));
  }
  const evidenceTargets = new Map<string, Set<string>>();
  for (const run of runs) {
    if (run.artifactInputTruncated) { warnings.add(`Scan ${run.id}: artifact input limit reached; inspect Scope details for the complete inventory.`); context.truncated = true; }
    if (run.partialCoverage) warnings.add(`Scan ${run.id}: active host enrichment was bounded; unprobed discoveries remain observations only.`);
    if (run.status !== 'COMPLETED' || run.outcome !== 'SUCCESS') warnings.add(`Scan ${run.id}: ${run.status}/${run.outcome ?? 'UNKNOWN'}; coverage is incomplete or unknown.`);
    if (run._count && (run._count.logs > run.logs.length || run._count.discoveries > run.discoveries.length)) {
      warnings.add(`Scan ${run.id}: input limit reached; consult the original Recon for all rows.`); context.truncated = true;
    }
    const source = (tool: string) => {
      const id = `${run.id}/${tool}`;
      if (!context.sources.some(s => s.id === id)) context.sources.push({ id, scanId: run.id, targetId: run.targetId, tool, status: run.status,
        ...(run.outcome ? { outcome: run.outcome } : {}), ...(run.startedAt ? { startedAt: iso(run.startedAt) } : {}), ...(run.finishedAt ? { completedAt: iso(run.finishedAt) } : {}) });
      return id;
    };
    source('recon');
    function merge<T extends ReconEvidence>(map: Map<string, T>, key: string, data: Omit<T, keyof ReconEvidence>, tool: string, reference: string, at: Date, value: string, confidence: ReconEvidence['confidence'] = 'OBSERVED') {
      const date = iso(at), existing = map.get(key), sourceId = source(tool);
      const kind = (data as { url?: string; name?: string; type?: string }).type ? 'observation' : (data as { name?: string }).name ? 'technology' : (data as { url?: string }).url ? 'endpoint' : 'asset';
      const id = reconHash(`${kind}:${key}`).slice(0, 24);
      const targetIds = evidenceTargets.get(id) ?? new Set<string>(); targetIds.add(run.targetId); evidenceTargets.set(id, targetIds);
      if (existing) {
        existing.sources = sorted([...existing.sources, sourceId]); existing.references = sorted([...existing.references, reference]);
        existing.firstSeenAt = [date, existing.firstSeenAt].sort()[0]; existing.lastSeenAt = [date, existing.lastSeenAt].sort().at(-1)!;
        return existing;
      }
      const record = { ...data, id, sources: [sourceId], references: [reference], firstSeenAt: date, lastSeenAt: date,
        confidence, freshness: 'RECENT', historical: false, inScope: input.inScope(value) } as T;
      map.set(key, record); return record;
    }
    const asset = (host: string, tool: string, ref: string, at: Date, verification: 'DISCOVERED' | 'PROBED' = 'DISCOVERED') => {
      try { host = normalizeFqdn(host); if (host.startsWith('*.')) return; } catch { warnings.add(`Scan ${run.id}: invalid hostname omitted.`); return; }
      const record = merge(maps.assets, host, { hostname: host, verification }, tool, ref, at, host);
      if (verification === 'PROBED') record.verification = verification;
    };
    const endpoint = (raw: string, tool: string, ref: string, at: Date, method?: string, parameters: string[] = [], authenticatedCrawl?: boolean, verification: 'DISCOVERED' | 'PROBED' = 'DISCOVERED') => {
      const parsed = observedUrl(raw); if (!parsed) { warnings.add(`Scan ${run.id}: invalid URL omitted.`); return; }
      const key = `${method ?? '?'} ${parsed.url}`;
      const safeForActiveReview = isSafeReadUrl(raw);
      const record = merge(maps.endpoints, key, { url: parsed.url, ...(method ? { method } : {}), parameters: sorted([...parsed.parameters, ...parameters.filter(cleanParameter)]), verification, safeForActiveReview,
        ...(authenticatedCrawl !== undefined ? { authenticatedCrawl } : {}) }, tool, ref, at, raw);
      record.parameters = sorted([...record.parameters, ...parsed.parameters, ...parameters.filter(cleanParameter)]);
      record.safeForActiveReview &&= safeForActiveReview;
      if (authenticatedCrawl) record.authenticatedCrawl = true;
      if (verification === 'PROBED') record.verification = verification;
      const seen = endpointRuns.get(record.id) ?? new Set<string>(); seen.add(run.id); endpointRuns.set(record.id, seen);
      // Do not lift path/port authorization to a whole hostname.
      asset(new URL(parsed.url).hostname, tool, ref, at, verification);
      return record;
    };
    for (const d of run.discoveries) {
      const tool = ['SUBFINDER', 'CERTIFICATE_TRANSPARENCY', 'SCOPE_RULE', 'GAU'].includes(d.source) ? d.source.toLowerCase() : 'discovery';
      asset(d.host, tool, `HostDiscovery:${d.id}`, d.createdAt);
    }
    if (run.artifacts) {
      for (const a of run.artifacts) for (const s of a.sources) {
        const v=a.value,tool=s.tool,ref=`ReconArtifact:${a.id};${s.sourceRef}`,at=new Date(s.observedAt),url=typeof v.url==='string'?v.url:undefined,host=typeof v.hostname==='string'?v.hostname:run.target.host;
        if(a.kind==='hostname')asset(host,tool,ref,at,a.verification==='OBSERVED'?'PROBED':'DISCOVERED');
        else if(a.kind==='endpoint'||a.kind==='url'||a.kind==='parameter'){
          if(!url)continue;const method=typeof v.method==='string'&&/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(v.method)?v.method:undefined;
          const e=endpoint(url,tool,ref,at,method,a.kind==='parameter'&&typeof v.name==='string'?[v.name]:[],undefined,a.verification==='OBSERVED'?'PROBED':'DISCOVERED');
          if(e&&typeof v.statusCode==='number')e.statusCode=v.statusCode;if(e&&typeof v.contentType==='string')e.contentType=v.contentType;
          if(e&&v.safeForActiveReview===false)e.safeForActiveReview=false;
        }else if(a.kind==='technology'&&typeof v.name==='string'&&/^[a-z0-9][a-z0-9 .+:/_-]{0,79}$/i.test(v.name))merge(maps.technologies,`${host}:${v.name.toLowerCase()}`,{name:v.name,asset:host},tool,ref,at,host,'INFERRED');
        else{
          const type=a.kind==='observation'&&typeof v.type==='string'?v.type:a.kind;
          const description=type==='nuclei-recon'?`Read-only Recon template ${String(v.templateId)} matched; this is not a confirmed vulnerability.`:type==='burp-history'?'Existing Burp history metadata, not a live verification. Collection time does not establish the original request date.':a.kind==='auth-surface'?'Authentication surface observed; access-control behavior requires verification.':a.kind==='port'||a.kind==='service'?`TCP port ${String(v.port)} observed ${String(v.state??'service label')}; version and vulnerability unconfirmed.`:a.kind==='api-surface'?'API surface signal observed; behavior and authorization require verification.':`Structured ${type} observation; review the original artifact.`;
          merge(maps.observations,`${a.kind}:${a.canonicalKey}`,{type,description,asset:url??host,facts:v},tool,ref,at,url??host,a.verification==='OBSERVED'?'OBSERVED':'INFERRED');
          if(url&&tool==='burp'){const e=endpoint(url,tool,ref,at,typeof v.method==='string'?v.method:undefined);if(e&&typeof v.statusCode==='number')e.statusCode=v.statusCode;}
        }
      }
      continue; // Structured runs never reparse scanner logs or legacy corpus.
    }
    const parsed = persistedCorpusSchema.safeParse(run.reconCorpus);
    if (parsed.success) {
      const c = parsed.data, at = new Date(c.capturedAt), ref = run.corpusReference ?? `ScanRun:${run.id}:reconCorpus`;
      for (const [field, values] of [['urls', c.urls], ['jsUrls', c.jsUrls], ['authUrls', c.authUrls]] as const) {
        for (const url of sorted(values)) endpoint(url, 'corpus-v1', `${ref}.${field}`, at, undefined, c.queryParams.filter(p => observedUrl(p.url)?.url === observedUrl(url)?.url).map(p => p.key), c.authenticated);
      }
      for (const p of c.queryParams) endpoint(p.url, 'corpus-v1', `${ref}.queryParams`, at, undefined, [p.key], c.authenticated);
      for (const form of c.forms) {
        const method = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(form.method) ? form.method : undefined;
        endpoint(form.url, 'corpus-v1', `${ref}.forms`, at, method, form.fields, c.authenticated);
      }
      for (const name of c.technologies) {
        // The actual v1 corpus only emits technology names; no version evidence is persisted.
        if (!/^(next\.js|express|node|rails|ruby|django|jinja|twig|php|nginx|apache|iis|asp\.net|tomcat|jetty|spring|java)$/i.test(name)) { warnings.add(`Scan ${run.id}: unsupported technology signature omitted.`); continue; }
        merge(maps.technologies, `${run.target.host}:${name.toLowerCase()}`, { name: name.toLowerCase(), asset: run.target.host }, 'corpus-v1', `${ref}.technologies`, at, run.target.host, 'INFERRED');
      }
      for (const [signal, present] of Object.entries(c.surface)) if (present) merge(maps.observations, `${run.target.host}:${signal}`, { type: signal, description: `Recon corpus recorded the ${signal} surface signal; requires investigation.`, asset: run.target.host }, 'corpus-v1', `${ref}.surface.${signal}`, at, run.target.host, 'INFERRED');
    } else if (run.reconCorpus !== null) warnings.add(`Scan ${run.id}: malformed or unsupported corpus; valid discoveries/logs retained.`);
    const richRef = `ScanRun:${run.id}:assetResults:${run.target.host}`;
    for (const url of run.historicalUrls ?? []) {
      endpoint(url, 'gau', `ScanRun:${run.id}:assetResults.historicalUrls`, run.finishedAt ?? run.createdAt);
      merge(maps.observations, `${url}:archive`, { type: 'historical-url', asset: observedUrl(url)?.url ?? run.target.host, description: 'URL collected from a historical archive. Live accessibility and original observation date are unknown; collection time is not a live verification.' }, 'gau', `ScanRun:${run.id}:assetResults.historicalUrls`, run.finishedAt ?? run.createdAt, url, 'INFERRED');
    }
    for (const http of run.httpObservations ?? []) {
      const e = endpoint(http.url, 'asset-http', `${richRef}.http`, new Date(http.observedAt), http.method, [], undefined, 'PROBED');
      if (e && http.observedAt >= e.lastSeenAt) { e.statusCode = http.statusCode; e.contentType = http.contentType; }
      if (http.authenticationSchemes.length) merge(maps.observations, `${http.url}:http-authentication`, { type: 'http-authentication', asset: http.url, description: `HTTP authentication challenge schemes observed: ${http.authenticationSchemes.join(', ')}. This does not establish access-control behavior.` }, 'asset-http', `${richRef}.http`, new Date(http.observedAt), http.url);
      if (http.redirect) merge(maps.observations, `${http.url}:redirect:${http.redirect}`, { type: 'redirect', asset: http.redirect, description: 'HTTP redirect destination observed, not automatically followed or authorized.' }, 'asset-http', `${richRef}.http`, new Date(http.observedAt), http.redirect);
    }
    for (const address of run.dnsAddresses ?? []) if (isIP(address)) merge(maps.observations, `${run.target.host}:dns:${address}`, { type: 'dns-address', asset: run.target.host, description: `DNS address observed: ${address}; IP testing is not authorized by this association.` }, 'dns', `${richRef}.dns`, run.finishedAt ?? run.createdAt, run.target.host);
    for (const port of run.portObservations ?? []) merge(maps.observations, `${run.target.host}:tcp:${port.port}:${port.state}`, { type: 'tcp-port', asset: run.target.host, description: `TCP port ${port.port} observed ${port.state}; service label ${port.serviceLabel} is not version confirmation.` }, 'nmap', `${richRef}.ports`, run.finishedAt ?? run.createdAt, run.target.host);
    if (run.tlsObservation) merge(maps.observations, `${run.target.host}:tls:${run.tlsObservation.fingerprint256}`, { type: 'tls-certificate', asset: run.target.host, description: `TLS certificate observed, fingerprint ${run.tlsObservation.fingerprint256}; validity ${run.tlsObservation.validFrom} to ${run.tlsObservation.validTo}.` }, 'tls', `${richRef}.tls`, run.finishedAt ?? run.createdAt, run.target.host);
    // Legacy scanners persist stdout, not JSONL. Only recognize their bounded, actual formats.
    let tool = '';
    for (const log of [...run.logs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))) {
      if (log.line.length > 16384) { warnings.add(`Scan ${run.id}: oversized log row omitted.`); continue; }
      const start = /^\$ (httpx|katana|nmap|subfinder) /.exec(log.line);
      if (start) { tool = start[1]; continue; }
      if (/^\[recon\]/.test(log.line)) { tool = ''; continue; }
      if (log.stream !== 'STDOUT') continue;
      const ref = `ScanLog:${log.id}`;
      if ((tool === 'katana' || tool === 'httpx') && /^https?:\/\/\S+$/.test(log.line)) endpoint(log.line, tool, ref, log.createdAt, undefined, [], undefined, tool === 'httpx' ? 'PROBED' : 'DISCOVERED');
      else if (tool === 'nmap') {
        const port = /^(\d{1,5})\/tcp\s+(open|closed|filtered)\s+([a-z0-9?/_-]{1,40})\s*$/.exec(log.line);
        if (port && Number(port[1]) <= 65535) merge(maps.observations, `${run.target.host}:tcp:${port[1]}:${port[2]}`, { type: 'tcp-port', asset: run.target.host,
          description: `TCP port ${port[1]} observed ${port[2]}; service label ${port[3]} is not a version or vulnerability confirmation.` }, tool, ref, log.createdAt, run.target.host);
      } else if (log.line.startsWith('[dns] ')) {
        try {
          const records: unknown = JSON.parse(log.line.slice(6));
          if (!Array.isArray(records)) throw new Error();
          for (const record of records.slice(0, 100)) if (record && typeof record === 'object' && 'address' in record && typeof record.address === 'string' && isIP(record.address)) {
            // DNS address is an association, never authorization for active IP testing.
            merge(maps.observations, `${run.target.host}:dns:${record.address}`, { type: 'dns-address', asset: run.target.host, description: `DNS address observed: ${record.address}; IP testing is not authorized by this association.` }, 'dns', ref, log.createdAt, run.target.host);
          }
        } catch { warnings.add(`Scan ${run.id}: malformed DNS log omitted.`); }
      }
    }
  }
  context.assets = [...maps.assets.values()]; context.endpoints = [...maps.endpoints.values()];
  context.technologies = [...maps.technologies.values()]; context.observations = [...maps.observations.values()];
  for (const name of ['assets', 'endpoints', 'technologies', 'observations'] as const) {
    context[name].sort((a, b) => a.id.localeCompare(b.id));
    for (const item of context[name]) {
      item.freshness = reconFreshness(item.lastSeenAt, input.generatedAt);
      item.historical = [...(evidenceTargets.get(item.id) ?? [])].every(targetId => {
        const newest = latest.get(targetId); return Boolean(newest && item.lastSeenAt < latestTime.get(targetId)! && !item.sources.some(s => s.startsWith(`${newest}/`)));
      });
      if (item.sources.length && item.sources.every(source => source.endsWith('/gau'))) item.historical = true;
      if (item.sources.length && item.sources.every(source => source.endsWith('/burp'))) item.historical = true;
    }
  }
  context.sources.sort((a, b) => a.id.localeCompare(b.id));
  for (const e of context.endpoints) {
    if (!e.inScope || e.historical || e.freshness === 'STALE' || !e.safeForActiveReview || !isSafeReadUrl(e.url)) continue;
    const path = new URL(e.url).pathname, signals: string[] = [];
    let score = 0;
    if (/\/(admin|manage|console|dashboard)(\/|$)/i.test(path)) { signals.push('Administrative route name; access control is unverified.'); score += 30; }
    if (/\/(api|v\d+|graphql)(\/|$)/i.test(path)) { signals.push('API route observed.'); score += 20; }
    if (e.parameters.length) { signals.push('Parameter names observed; values omitted.'); score += 15; }
    const authChallenge = context.observations.find(o => o.type === 'http-authentication' && o.asset === e.url && !o.historical && o.freshness !== 'STALE');
    if (authChallenge) { signals.push('HTTP authentication challenge observed; access-control behavior requires verification.'); score += 20; }
    if (e.authenticatedCrawl) { signals.push('Discovered during an authenticated crawl; authentication requirement is unverified.'); score += 10; }
    const sourceTargets = evidenceTargets.get(e.id) ?? new Set<string>();
    const isNew = [...sourceTargets].some(t => {
      const newest = latest.get(t), previous = previousCompleted.get(t), seen = endpointRuns.get(e.id)!;
      return newest && previous && seen.has(newest) && !seen.has(previous);
    });
    if (isNew) { signals.push('Absent from the previous retained corpus and present in the latest; coverage may differ.'); score += 10; }
    if (!signals.length) continue;
    if (e.freshness === 'AGING') score -= 10;
    context.suggestions.push({ id: `review-${e.id}`, asset: e.url, reason: signals.join(' '), signals, observationIds: [e.id], sources: e.sources,
      confidence: 'LOW', freshness: e.freshness, scopeId: input.scopeId, mode: input.activeSuggestionsAllowed ? 'SCOPED_REVIEW' : 'PASSIVE_REVIEW', score,
      ...(authChallenge ? { observationIds: [e.id, authChallenge.id], sources: sorted([...e.sources, ...authChallenge.sources]) } : {}) });
  }
  for (const item of [...context.technologies, ...context.observations.filter(o => o.type === 'tcp-port' && /observed open/.test(o.description))]) {
    if (!item.inScope || item.historical || item.freshness === 'STALE') continue;
    const reason = 'name' in item ? 'Technology signature observed; verify the technology and version using existing evidence before selecting relevant hypotheses.' : 'Open TCP port observed; review the service evidence and authorization before investigating. A port label does not confirm a service version or vulnerability.';
    context.suggestions.push({ id: `review-${item.id}`, asset: item.asset!, reason, signals: [reason], observationIds: [item.id], sources: item.sources,
      confidence: 'LOW', freshness: item.freshness, scopeId: input.scopeId, mode: input.activeSuggestionsAllowed ? 'SCOPED_REVIEW' : 'PASSIVE_REVIEW', score: item.freshness === 'AGING' ? 5 : 15 });
  }
  for (const suggestion of context.suggestions) {
    const scopeAsset = context.scopeAssets?.find(a => a.active && (suggestion.asset.startsWith('http') ? assetAllowsUrl(a, suggestion.asset) : assetAllowsHost(a, suggestion.asset)));
    if (scopeAsset) { suggestion.scopeAssetId = scopeAsset.id; suggestion.assetValue = scopeAsset.assetValue; suggestion.assetType = scopeAsset.type; }
  }
  context.suggestions.sort((a, b) => assetValueRank(a.assetValue ?? 'MEDIUM') - assetValueRank(b.assetValue ?? 'MEDIUM') || b.score - a.score || a.id.localeCompare(b.id));
  context.suggestions = context.suggestions.slice(0, 20);
  if (!runs.length) warnings.add('No Recon results available. Missing results do not demonstrate absence of vulnerabilities.');
  if ([...context.assets, ...context.endpoints, ...context.technologies, ...context.observations].some(item => item.freshness !== 'RECENT')) warnings.add('Some observations are older than seven days; stale observations over thirty days are excluded from suggestions. Freshness must be reassessed at the time of use.');
  warnings.add('Discovered URLs, route names, port labels and technology signatures are observations, not verified reachability, versions or vulnerabilities. Missing observations are not negative security evidence.');
  if (context.observations.some(o => o.historical) || context.endpoints.some(o => o.historical)) warnings.add('Historical observations are retained; absence from a later scan may reflect coverage differences.');
  for (const name of ['assets', 'endpoints', 'technologies', 'observations', 'sources', 'suggestions'] as const) context.counts[name] = context[name].length;
  const graph=deriveAssetGraph(runs.flatMap(r=>r.artifacts??[]),{nodes:100,edges:150});
  while(Buffer.byteLength(reconJson(graph))>131072){if(graph.edges.length)graph.edges.pop();else graph.nodes.pop();graph.truncated=true;}
  if(graph.nodes.length){context.assetGraph={...graph,nodes:graph.nodes.map(n=>({...n,inScope:['HOSTNAME','ENDPOINT'].includes(n.type)&&input.inScope(n.value)}))};}
  context.warnings = [...warnings].sort();
  while (context.scopeAssets && Buffer.byteLength(reconJson(context.scopeAssets)) > RECON_DETAIL_BYTES / 3) { context.scopeAssets.splice(-Math.max(1, Math.ceil(context.scopeAssets.length / 10))); context.truncated = true; }
  // Explicit truncation, stable ordering and retained-source closure keep the artifact bounded.
  while (Buffer.byteLength(reconJson(context)) > RECON_DETAIL_BYTES - 512) {
    const biggest = [...(['assets', 'endpoints', 'technologies', 'observations'] as const)].sort((a, b) => context[b].length - context[a].length)[0];
    context[biggest].splice(-Math.max(1, Math.ceil(context[biggest].length / 10))); context.truncated = true;
    const ids = new Set([...context.endpoints, ...context.observations, ...context.assets, ...context.technologies].map(v => v.id));
    context.suggestions = context.suggestions.filter(s => s.observationIds.every(id => ids.has(id)));
  }
  if (context.truncated) context.warnings.push('Snapshot is bounded; original Recon retains the full available evidence. Counts describe normalized input before output truncation.');
  return context;
}
export function compactReconContext(context: ResearchReconContext): ResearchReconContext {
  const compact = structuredClone(context);
  if(compact.assetGraph){delete compact.assetGraph;compact.truncated=true;}
  // Prioritized endpoints first; complete bounded evidence remains in the immutable detail file.
  const rank = new Map(compact.suggestions.flatMap((s, i) => s.observationIds.map(id => [id, i] as const)));
  compact.endpoints.sort((a, b) => (rank.get(a.id) ?? 100) - (rank.get(b.id) ?? 100) || a.id.localeCompare(b.id));
  compact.endpoints = compact.endpoints.slice(0, 12); compact.assets = compact.assets.slice(0, 12);
  compact.technologies = compact.technologies.slice(0, 12); compact.observations = compact.observations.slice(0, 12); compact.suggestions = compact.suggestions.slice(0, 8);
  compact.warnings = compact.warnings.slice(0, 20);
  if (compact.scopeAssets && compact.scopeAssets.length > 20) { compact.scopeAssets = compact.scopeAssets.slice(0, 20); compact.truncated = true; }
  const selected = new Set([...compact.endpoints, ...compact.assets, ...compact.technologies, ...compact.observations].flatMap(r => r.sources).concat(compact.suggestions.flatMap(s => s.sources)));
  compact.sources = compact.sources.filter(s => selected.has(s.id));
  while (Buffer.byteLength(reconJson(compact)) > RECON_SUMMARY_BYTES) {
    if (compact.scopeAssets?.length && Buffer.byteLength(reconJson(compact.scopeAssets)) > RECON_SUMMARY_BYTES / 3) { compact.scopeAssets.pop(); compact.truncated = true; continue; }
    const key = [...(['endpoints', 'assets', 'technologies', 'observations', 'suggestions', 'sources', 'warnings'] as const)].sort((a, b) => JSON.stringify(compact[b]).length - JSON.stringify(compact[a]).length)[0];
    compact[key].pop(); compact.truncated = true;
  }
  compact.truncated ||= ['endpoints', 'assets', 'technologies', 'observations', 'sources', 'suggestions'].some(k => context.counts[k as keyof typeof context.counts] > (compact[k as keyof typeof context.counts] as unknown[]).length);
  return compact;
}
