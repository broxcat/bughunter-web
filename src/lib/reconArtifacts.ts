import { z } from 'zod';
import { assetAllowsHost, assetAllowsUrl, type AssetBoundary } from './scopeAssets';
import { normalizeFqdn, isExcluded } from './bountyProgram';
import { safeObservationUrl, redactObservationText, isSafeReadUrl } from './observationSafety';

export const artifactKinds = ['hostname','url','endpoint','parameter','port','service','technology','tls','auth-surface','api-surface','observation'] as const;
export type ArtifactKind = typeof artifactKinds[number];
export type ArtifactSource = { tool: string; sourceRef: string; observedAt: string; provider?: string; version?: string };
export type ReconArtifactData = { id?: string; kind: ArtifactKind; canonicalKey: string; value: Record<string, unknown>; scopeState: 'IN_SCOPE' | 'OUT_OF_SCOPE'; verification: 'DISCOVERED' | 'OBSERVED' | 'DECLARED'; sources: ArtifactSource[]; firstSeenAt: string; lastSeenAt: string };
const valueSchema = z.record(z.string().max(60), z.union([z.string().max(4096),z.number().finite(),z.boolean(),z.array(z.string().max(300)).max(40)]));
export function canonicalReconUrl(raw: string) {
  if (raw.length > 4096 || /[\x00-\x20\x7f\\]/.test(raw)) throw new Error('Invalid observation URL');
  const u = new URL(safeObservationUrl(raw)); if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error('Invalid observation URL');
  normalizeFqdn(u.hostname); u.hash = '';
  const params = [...u.searchParams.keys()].filter(k => /^[a-z_][a-z0-9_.[\]-]{0,63}$/i.test(k)).sort();
  u.search = ''; for (const key of [...new Set(params)]) u.searchParams.append(key, '');
  // Root and directory trailing slash variants share an endpoint identity. The
  // observed schemes stay distinct: HTTP and HTTPS are different services.
  if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}
export function classifyReconUrl(value: string) {
  const p = new URL(value).pathname;
  return /\.(?:js|mjs|css|map|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)(?:$|\/)/i.test(p) || /\/_next\/static\//i.test(p) ? 'static' : /auth|login|register|sign[io]n|reset|password|mfa|oauth/i.test(p) ? 'auth' : /\/(api|v\d+|graphql|swagger|openapi)(\/|\.|$)/i.test(p) ? 'api' : /admin|manage|console|dashboard/i.test(p) ? 'admin' : /upload|attachment|import/i.test(p) ? 'upload' : /account|profile|user/i.test(p) ? 'account' : /health|status|debug|metrics/i.test(p) ? 'status/debug' : /checkout|cart|course|order|billing|payment|plan/i.test(p) ? 'business functionality' : new URL(value).search ? 'interesting parameters' : 'other dynamic routes';
}
/** Derives identities and scope state; a scanner-supplied flag is never trusted. */
export function normalizeArtifact(kind: ArtifactKind, raw: Record<string, unknown>, source: ArtifactSource, boundary: AssetBoundary, exclusions: string[], verification: ReconArtifactData['verification'] = 'DISCOVERED'): ReconArtifactData | null {
  try {
    if (!artifactKinds.includes(kind) || !Number.isFinite(Date.parse(source.observedAt)) || !/^[a-z0-9_-]{1,40}$/i.test(source.tool)) return null;
    const value = valueSchema.parse(JSON.parse(redactObservationText(JSON.stringify(raw))));
    for (const [key,v] of Object.entries(value)) if (typeof v === 'string') value[key] = redactObservationText(v).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, key === 'url' ? 4096 : 500);
    let host: string, canonicalKey: string, inScope: boolean;
    if (typeof raw.url === 'string') {
      const url = canonicalReconUrl(raw.url); host = new URL(url).hostname; value.url = url; value.category = classifyReconUrl(url);
      value.safeForActiveReview = isSafeReadUrl(raw.url) && raw.safeForActiveReview !== false;
      if (kind === 'parameter' && (typeof value.name !== 'string' || !/^[a-z_][a-z0-9_.[\]-]{0,63}$/i.test(value.name))) return null;
      canonicalKey = `${url}|${value.method ?? '?'}|${kind === 'parameter' ? value.name : kind === 'observation' ? [value.type,value.templateId,value.requestRef,value.responseRef].filter(v=>v!==undefined).join('|') : ''}`;
      inScope = assetAllowsUrl(boundary, raw.url);
    } else {
      host = normalizeFqdn(String(raw.hostname ?? raw.host ?? '')); if (host.startsWith('*.')) return null; value.hostname = host;
      canonicalKey = `${host}|${kind === 'port' || kind === 'service' ? `${value.port}/${value.protocol ?? 'tcp'}` : kind==='technology'?String(value.name??'').toLowerCase():value.name ?? value.fingerprint ?? value.type ?? ''}`;
      inScope = assetAllowsHost(boundary, host);
    }
    if (value.statusCode !== undefined && (typeof value.statusCode !== 'number' || !Number.isInteger(value.statusCode) || value.statusCode < 100 || value.statusCode > 599)) {delete value.statusCode;if(kind==='endpoint'||kind==='url')verification='DISCOVERED';}
    if (value.port !== undefined && (typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535)) return null;
    if (kind === 'technology') { delete value.version; value.versionConfirmed = false; }
    const safeSource = { tool: source.tool, sourceRef: redactObservationText(source.sourceRef).slice(0,250), observedAt: new Date(source.observedAt).toISOString(), ...(source.provider ? { provider: source.provider.replace(/[^a-z0-9_.-]/gi,'').slice(0,60) } : {}), ...(source.version ? { version: redactObservationText(source.version).slice(0,100) } : {}) };
    return { kind, canonicalKey, value, scopeState: inScope && !isExcluded(host, exclusions) ? 'IN_SCOPE' : 'OUT_OF_SCOPE', verification, sources: [safeSource], firstSeenAt: safeSource.observedAt, lastSeenAt: safeSource.observedAt };
  } catch { return null; }
}
export function deduplicateArtifacts(rows: ReconArtifactData[]) {
  const map = new Map<string, ReconArtifactData>();
  for (const row of rows) {
    const key = row.kind + ':' + row.canonicalKey, old = map.get(key);
    if (!old) { map.set(key, structuredClone(row)); continue; }
    const addresses=old.value.type==='dns-address'&&Array.isArray(old.value.addresses)&&Array.isArray(row.value.addresses)?[...new Set([...old.value.addresses,...row.value.addresses])].sort():undefined;
    const safe=old.value.safeForActiveReview!==false&&row.value.safeForActiveReview!==false;
    if (row.lastSeenAt >= old.lastSeenAt) old.value = { ...old.value, ...row.value };
    if(addresses)old.value.addresses=addresses;
    if('safeForActiveReview' in old.value)old.value.safeForActiveReview=safe;
    old.firstSeenAt = [old.firstSeenAt,row.firstSeenAt].sort()[0]; old.lastSeenAt = [old.lastSeenAt,row.lastSeenAt].sort().at(-1)!;
    old.sources = [...new Map([...old.sources,...row.sources].map(s => [JSON.stringify(s),s])).values()].sort((a,b) => a.tool.localeCompare(b.tool) || a.sourceRef.localeCompare(b.sourceRef) || a.observedAt.localeCompare(b.observedAt));
    if (row.verification === 'OBSERVED') old.verification = 'OBSERVED';
  }
  return [...map.values()].sort((a,b) => a.kind.localeCompare(b.kind) || a.canonicalKey.localeCompare(b.canonicalKey));
}
export function reconDiff(current: ReconArtifactData[], previous: ReconArtifactData[], comparable: boolean) {
  const key = (r: ReconArtifactData) => `${r.kind}:${r.canonicalKey}`, a = new Map(current.map(r => [key(r),r])), b = new Map(previous.map(r => [key(r),r]));
  const compact = (r: ReconArtifactData) => ({ artifactId: r.id, kind: r.kind, key: r.canonicalKey, value: r.value });
  return { version: 1, comparable, coverageWarning: 'Not observed in this run does not prove disappearance; compare coverage and blocked stages.',
    new: current.filter(r => !b.has(key(r))).map(compact), removed: comparable ? previous.filter(r => !a.has(key(r))).map(compact) : [],
    changed: current.filter(r => b.has(key(r)) && JSON.stringify(r.value) !== JSON.stringify(b.get(key(r))!.value)).map(compact) };
}
