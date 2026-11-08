import { redactObservationText, safeObservationUrl } from './observationSafety';
import { staticCategory } from './reconReportEvidence';

type Artifact = {
  kind: string;
  scopeState: string;
  verification: string;
  value: unknown;
  sources: unknown;
};

const kinds: Record<string, string> = {
  hostname: 'Hôte', url: 'URL', endpoint: 'Route HTTP', parameter: 'Paramètre',
  port: 'Port', service: 'Service', technology: 'Technologie', tls: 'TLS',
  'auth-surface': 'Authentification', 'api-surface': 'API', observation: 'Signal',
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function safeText(value: unknown) {
  return typeof value === 'string'
    ? redactObservationText(value).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 400)
    : '';
}

function urlFor(value: unknown) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return '';
  const safe = safeObservationUrl(value);
  return safe === '[REDACTED URL]' ? '' : safe;
}

function describe(kind: string, value: Record<string, unknown>, observed: boolean) {
  const url = urlFor(value.url);
  const host = safeText(value.hostname) || safeText(value.host);
  const surface = url || host;
  if (kind === 'port' || kind === 'service') {
    const port = value.port;
    if (!host || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return '';
    return [`${host} · ${port}`, safeText(value.protocol), safeText(value.name || value.service), safeText(value.state)].filter(Boolean).join(' · ');
  }
  const label = safeText(value.templateId || value.name || value.type);
  const status = value.statusCode;
  const http = observed && typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? `HTTP ${status}` : '';
  return [surface, label, http].filter(Boolean).join(' · ');
}

function priorityFor(kind: string, value: Record<string, unknown>, observed: boolean) {
  const url = urlFor(value.url);
  if (kind === 'observation' && value.type === 'nuclei-recon' && observed && url && safeText(value.templateId)) {
    const strong = ['medium', 'high', 'critical'].includes(String(value.severity).toLowerCase());
    return {
      rank: strong ? 0 : 2,
      check: 'Reproduire le match du template et vérifier son impact avec un cas témoin.',
    };
  }
  if ((kind === 'api-surface' || kind === 'auth-surface') && url) {
    return {
      rank: observed ? 1 : 3,
      check: 'Vérifier la surface, puis comparer les réponses avec les rôles autorisés.',
    };
  }
  if (kind === 'port' && observed && value.state === 'open' && value.port !== 80 && value.port !== 443) {
    return { rank: 2, check: 'Identifier le service exposé et vérifier si son accès est attendu.' };
  }
  if ((kind === 'endpoint' || kind === 'url' || kind === 'parameter') && url && !staticCategory(url)) {
    const status = value.statusCode;
    if (kind === 'parameter' || (observed && typeof status === 'number' && (status === 401 || status === 403 || (status >= 200 && status < 300)))) {
      return { rank: 3, check: 'Vérifier la route et ses paramètres avec une requête témoin.' };
    }
  }
  return null;
}

export function buildScanSummary(artifacts: Artifact[], total: number) {
  type Example = { label: string; observation: string; observed: boolean; inScope: boolean };
  type Priority = Example & { rank: number; check: string; tools: string[] };
  const tools = new Map<string, { counts: Map<string, number>; examples: Example[] }>();
  const priorities = new Map<string, Priority>();

  for (const row of artifacts) {
    const label = Object.hasOwn(kinds, row.kind) ? kinds[row.kind] : 'Observation';
    const value = object(row.value);
    const observed = row.verification === 'OBSERVED';
    const inScope = row.scopeState === 'IN_SCOPE';
    const observation = describe(row.kind, value, observed);
    const example = { label, observation, observed, inScope };
    const sources = Array.isArray(row.sources) ? row.sources : [];
    const names = [...new Set(sources.map(source => safeText(object(source).tool)).filter(Boolean))];
    if (!names.length) names.push('Source non renseignée');

    for (const name of names) {
      const bucket = tools.get(name) ?? { counts: new Map<string, number>(), examples: [] };
      bucket.counts.set(label, (bucket.counts.get(label) ?? 0) + 1);
      if (observation && bucket.examples.length < 3 && !bucket.examples.some(item => item.observation === observation && item.label === label)) {
        bucket.examples.push(example);
      }
      tools.set(name, bucket);
    }

    const priority = inScope && observation ? priorityFor(row.kind, value, observed) : null;
    if (!priority) continue;
    const key = JSON.stringify([label, observation]);
    const previous = priorities.get(key);
    const best = previous && previous.rank <= priority.rank ? previous : { ...example, ...priority };
    priorities.set(key, { ...best, tools: [...new Set([...(previous?.tools ?? []), ...names])].sort() });
  }

  return {
    total,
    analyzed: artifacts.length,
    priorities: [...priorities.values()].sort((a, b) => a.rank - b.rank || a.observation.localeCompare(b.observation)).slice(0, 6),
    tools: [...tools].sort(([a], [b]) => a.localeCompare(b)).map(([name, bucket]) => ({
      name,
      counts: [...bucket.counts].sort(([a], [b]) => a.localeCompare(b)),
      examples: bucket.examples,
    })),
  };
}

export type ScanSummary = ReturnType<typeof buildScanSummary> & { fromLegacyLogs?: boolean; legacyTruncated?: boolean };
