import { createHash, randomUUID } from 'node:crypto';
import { isSafeReadUrl, redactObservationText, safeObservationUrl } from '@/lib/observationSafety';
import type { ProbeResult } from '../scanners/http';

export type UnknownPathBehavior = 'REAL_404' | 'SOFT_404' | 'WILDCARD_REDIRECT' | 'WILDCARD_CONTENT' | 'UNSTABLE_BASELINE';
export type ResponseFingerprint = {
  status: number; length: number; bodyHash: string; normalizedBodyHash: string;
  contentType: string; redirectPattern?: string; title?: string; semanticMarkers: string[];
};
export type UnknownPathBaseline = {
  version: 1; classification: UnknownPathBehavior; stable: boolean;
  statusCodes: number[]; lengths: number[]; bodyHashes: string[];
  normalizedBodyHashes: string[]; contentTypes: string[]; redirectPattern?: string;
  samples: ResponseFingerprint[]; sampleCount: number; errors: number;
  /** Known distinct responses establish that a length exclusion can discriminate. */
  distinguishingResponseLengths?: number[];
};
const unique = <T>(values: T[]) => [...new Set(values)].sort();
function replaceRequestText(text: string, url: URL) {
  const variants = [url.href, url.pathname + url.search, url.pathname, url.pathname.split('/').at(-1) ?? '']
    .filter(Boolean).flatMap(v => [v, encodeURIComponent(v), v.replaceAll('/', '\\/')]).sort((a, b) => b.length - a.length);
  for (const part of [...new Set(variants)]) text = text.split(part).join('<input>');
  return text;
}
function normalizedBody(body: string, url: URL) {
  return replaceRequestText(body, url)
    // Remove only explicitly labelled volatile fields and standard nonce/ID
    // formats, never arbitrary business text or all numbers.
    .replace(/((?:nonce|request[-_ ]?id|trace[-_ ]?id|correlation[-_ ]?id|csrf[-_ ]?token|timestamp)\s*["']?\s*[:=]\s*["']?)[^\s"'<>;,}]+/gi, '$1<volatile>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z\b/g, '<time>')
    .replace(/\s+/g, ' ').trim();
}
function redirectPattern(value: string, source: URL) {
  try {
    const target = new URL(value, source);
    let path = replaceRequestText(new URL(safeObservationUrl(target.toString())).pathname, source);
    path = path.replace(/__bughunter_[A-Za-z0-9_-]+/g, '<input>');
    const params = [...target.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => {
      const normalized = replaceRequestText(v, source);
      return `${encodeURIComponent(key)}=${normalized.includes('<input>') ? '<input>' : '<value:'+createHash('sha256').update(v).digest('hex').slice(0,12)+'>'}`;
    });
    return `${target.origin}${path}${params.length ? '?' + params.join('&') : ''}`;
  } catch { return undefined; }
}
export function responseFingerprint(page: ProbeResult): ResponseFingerprint {
  const url = new URL(page.url), body = page.body.slice(0, 65536), normalized = normalizedBody(body, url);
  const semanticMarkers: string[] = [];
  if (/\[core\][\s\S]*repositoryformatversion\s*=/i.test(body)) semanticMarkers.push('git-config');
  if (/(?:^|\n)(?:APP_KEY|DB_PASSWORD|DATABASE_URL|AWS_ACCESS_KEY_ID)\s*=\S/m.test(body)) semanticMarkers.push('configuration-assignment');
  if (/"(?:openapi|swagger)"\s*:\s*"\d/.test(body) && /"paths"\s*:/.test(body)) semanticMarkers.push('api-specification');
  if (/type\s*=\s*["']?password\b/i.test(body)) semanticMarkers.push('password-input');
  if (/PHP Version|phpinfo\(\)/i.test(body)) semanticMarkers.push('php-info');
  return { status: page.error ? 0 : page.status, length: page.bodyLen, bodyHash: createHash('sha256').update(body).digest('hex'),
    normalizedBodyHash: createHash('sha256').update(normalized).digest('hex'),
    contentType: (page.headers['content-type'] ?? 'unknown').split(';')[0].trim().toLowerCase(),
    ...(page.headers.location ? { redirectPattern: redirectPattern(page.headers.location, url) } : {}),
    title: (()=>{const title=/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1];return title?redactObservationText(title).replace(/\s+/g,' ').slice(0,160):undefined;})(), semanticMarkers };
}
export function classifyBaseline(samples: ResponseFingerprint[], errors = 0): UnknownPathBaseline {
  const valid = samples.filter(s => s.status > 0), statusCodes = unique(valid.map(s => s.status));
  const lengths = unique(valid.map(s => s.length)), bodyHashes = unique(valid.map(s => s.bodyHash));
  const normalizedBodyHashes = unique(valid.map(s => s.normalizedBodyHash)), contentTypes = unique(valid.map(s => s.contentType));
  const patterns = unique(valid.map(s => s.redirectPattern).filter((v): v is string => !!v));
  const sufficient = valid.length >= 3 && errors === 0;
  const sameStatus = statusCodes.length === 1, sameContent = contentTypes.length === 1;
  const redirect = sufficient && sameStatus && statusCodes[0] >= 300 && statusCodes[0] < 400 && patterns.length === 1 && valid.every(s => s.redirectPattern === patterns[0]);
  const sameBody = sufficient && sameStatus && sameContent && normalizedBodyHashes.length === 1;
  const real404 = sufficient && sameStatus && [404, 410].includes(statusCodes[0]);
  const classification: UnknownPathBehavior = real404 ? 'REAL_404' : redirect ? 'WILDCARD_REDIRECT' :
    sameBody && statusCodes[0] === 200 ? 'SOFT_404' : sameBody ? 'WILDCARD_CONTENT' : 'UNSTABLE_BASELINE';
  return { version: 1, classification, stable: classification !== 'UNSTABLE_BASELINE', statusCodes, lengths, bodyHashes,
    normalizedBodyHashes, contentTypes, ...(redirect ? { redirectPattern: patterns[0] } : {}),
    samples, sampleCount: samples.length, errors };
}
export async function calibrateContent(baseUrl: string, request: (url: string) => Promise<ProbeResult>, options: {
  samples?: 3 | 4 | 5; signal?: AbortSignal; allowed?: (url: string) => boolean; knownResponses?: ProbeResult[];
} = {}): Promise<UnknownPathBaseline> {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const samples: ResponseFingerprint[] = []; let errors = 0;
  for (let n = 0; n < (options.samples ?? 3); n++) {
    options.signal?.throwIfAborted();
    const url = new URL(`__bughunter_${randomUUID().replaceAll('-', '')}`, base).toString();
    if (!isSafeReadUrl(url) || options.allowed && !options.allowed(url)) throw new Error('SCOPE_BLOCKED: calibration path outside authorized boundary');
    try {
      const page = await request(url);
      if (page.error || !page.status) { errors++; continue; }
      samples.push(responseFingerprint(page));
      if (page.status === 429) break; // shared backoff owns further target traffic
    } catch (error) { options.signal?.throwIfAborted(); if (error instanceof Error && /SCOPE_BLOCKED/.test(error.message)) throw error; errors++; }
  }
  const baseline=classifyBaseline(samples, errors);
  baseline.distinguishingResponseLengths=unique((options.knownResponses??[]).filter(page=>!page.error&&page.status>0&&!compareWithBaseline(page,baseline).equivalent&&!baseline.lengths.includes(page.bodyLen)).map(page=>page.bodyLen));
  return baseline;
}
export function compareWithBaseline(page: ProbeResult | ResponseFingerprint, baseline: UnknownPathBaseline) {
  const fingerprint = 'body' in page ? responseFingerprint(page) : page;
  if (!baseline.stable || !baseline.statusCodes.includes(fingerprint.status)) return { equivalent: false, reason: 'NO_STABLE_EQUIVALENCE' };
  const sameType = baseline.contentTypes.includes(fingerprint.contentType);
  const differentSemantic = fingerprint.semanticMarkers.some(marker => !baseline.samples.some(s => s.semanticMarkers.includes(marker)));
  if (differentSemantic) return { equivalent: false, reason: 'DISTINCT_SEMANTIC_MARKER' };
  if (baseline.redirectPattern) return baseline.redirectPattern === fingerprint.redirectPattern ? { equivalent: true, reason: 'MATCHES_UNKNOWN_REDIRECT' } : { equivalent: false, reason: 'DISTINCT_REDIRECT_PATTERN' };
  if (sameType && baseline.normalizedBodyHashes.includes(fingerprint.normalizedBodyHash)) return { equivalent: true, reason: 'MATCHES_UNKNOWN_CONTENT' };
  return { equivalent: false, reason: 'DISTINCT_RESPONSE_SIGNATURE' };
}
export function gobusterCalibrationPolicy(baseline: UnknownPathBaseline): {
  enabled: boolean; excludeLengths?: number[]; excludeStatuses?: number[]; reason: string;
} {
  if (baseline.classification === 'REAL_404') return { enabled: true, reason: 'Negative controls returned genuine 404/410 responses.' };
  // A global auth redirect may hide real protected endpoints behind the same
  // status and variable callback URL. Never blacklist all 307/302 responses.
  if (baseline.classification === 'WILDCARD_REDIRECT' || !baseline.stable) return { enabled: false, reason: 'NON_DISCRIMINATING_WILDCARD_RESPONSE' };
  if (baseline.lengths.length === 1 && baseline.samples.length >= 3 && baseline.distinguishingResponseLengths?.length && !baseline.samples.some(s => s.semanticMarkers.length)) {
    return { enabled: true, excludeLengths: [...baseline.lengths], reason: 'Stable unknown-path length excluded; native negative control remains enabled.' };
  }
  return { enabled: false, reason: 'NON_DISCRIMINATING_WILDCARD_RESPONSE' };
}
