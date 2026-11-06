/**
 * Deterministic Recon report.
 *
 * Every value here is derived from persisted execution evidence. Nothing is
 * inferred: a port appears only when a port artifact was recorded, a tool only
 * when the captured plan named it, and an invocation only when it was stored.
 * This model is authoritative; any AI narrative is a separate, optional layer.
 */
import { reconOverview } from './reconOverview';
import { redactObservationText } from './observationSafety';

export type ReportStep = { name: string; state: string; reason: string | null; details: unknown };

export type ReportArtifact = { kind: string; value: Record<string, unknown> };

export type ReportScan = {
  host: string | null;
  status: string;
  outcome: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  requiredUserAgent: string | null;
  authenticatedContexts: number;
  plan: { stages?: Array<{ name: string; tools?: string[] }> } | null;
  steps: ReportStep[];
  artifacts: ReportArtifact[];
  artifactCount: number;
  changeSet: unknown;
  toolVersions: unknown;
};

export type ReportFacts = {
  run: {
    id: string;
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    outcome: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'UNSUPPORTED' | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
  program: { companyName: string; platform: string | null; requiredUserAgent: string | null; outOfScope: string[]; rulesOfEngagement: string | null; assessmentMode: string };
  authorizedAssets: string[];
  scans: ReportScan[];
  authSurfaces: Array<{ contexts: Array<{ label: string }>; totals: { public: number; authenticatedOnly: number; sharedAuthenticated: number; observations: number } }>;
};

export type StageLine = { host: string; name: string; tools: string[]; state: string; label: string; reason: string | null };

export type ReconReportModel = {
  title: string;
  metadata: {
    program: string;
    platform: string | null;
    reconDate: string;
    duration: string | null;
    status: string;
    outcomeLabel: string;
    outcomeDetail: string | null;
    assessmentMode: string;
    hosts: number;
    stageCounts: { completed: number; partial: number; failed: number; skipped: number; unknown: number };
  };
  authorization: { authorized: string[]; observed: string[]; excluded: string[]; userAgent: string | null; rules: string | null; note: string };
  methodology: { stages: Array<{ name: string; tools: string[] }>; passiveOnly: boolean; authenticated: boolean };
  execution: StageLine[];
  tools: Array<{ name: string; version: string | null; invocation: string | null }>;
  dns: Array<{ host: string; source: string }>;
  network: Array<{ host: string; port: number; protocol: string | null; service: string | null; source: string }>;
  portDiscoveryPerformed: boolean;
  web: {
    responsiveHosts: string[];
    endpoints: Array<{ url: string; status: number | null; method: string | null }>;
    technologies: Array<{ name: string; version: string | null }>;
    authSurfaces: string[];
    apiSurfaces: string[];
    statusCodes: number[];
  };
  authenticated: { contexts: Array<{ label: string; publicObservations: number; authenticatedOnly: number }>; note: string | null };
  limitations: Array<{ host: string; stage: string; label: string; reason: string | null }>;
  changes: { comparable: boolean; new: number; changed: number; notObserved: number; unchanged: number; note: string } | null;
  researchHandoff: string[];
  observationsTotal: number;
};

const HOST_KINDS = new Set(['host', 'hostname', 'subdomain', 'domain']);
const rawStr = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
/** Every string that reaches the report is scrubbed by the shared evidence policy. */
const str = (value: unknown): string | null => { const text = rawStr(value); return text ? redactObservationText(text) : null; };
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});

function iso(value: string | null): string {
  if (!value) return 'Not recorded';
  const time = Date.parse(value);
  return Number.isNaN(time) ? 'Not recorded' : new Date(time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export function durationBetween(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const from = Date.parse(start), to = Date.parse(end);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  const seconds = Math.round((to - from) / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Tool versions are shown only when the run captured them for that exact tool. */
function versionFor(versions: unknown, tool: string): string | null {
  const record = obj(versions);
  return str(record[tool]);
}

export function buildReconReportModel(facts: ReportFacts): ReconReportModel {
  const overview = reconOverview({ status: facts.run.status, outcome: facts.run.outcome });

  const execution: StageLine[] = [];
  const tools = new Map<string, { name: string; version: string | null; invocation: string | null }>();
  const dns = new Map<string, { host: string; source: string }>();
  const network = new Map<string, { host: string; port: number; protocol: string | null; service: string | null; source: string }>();
  const endpoints = new Map<string, { url: string; status: number | null; method: string | null }>();
  const technologies = new Map<string, { name: string; version: string | null }>();
  const authSurfaces = new Set<string>();
  const apiSurfaces = new Set<string>();
  const statusCodes = new Set<number>();
  const responsiveHosts = new Set<string>();
  const observed = new Set<string>();
  const limitations: ReconReportModel['limitations'] = [];
  let observationsTotal = 0;
  let anyPortStage = false;

  for (const scan of facts.scans) {
    const host = scan.host ?? 'Unknown host';
    observationsTotal += scan.artifactCount;
    const planStages = Array.isArray(scan.plan?.stages) ? scan.plan!.stages! : [];

    for (const step of scan.steps) {
      const stageTools = planStages.find(stage => stage.name === step.name)?.tools ?? [];
      for (const tool of stageTools) {
        if (typeof tool === 'string' && tool.trim()) {
          const name = tool.trim();
          tools.set(name, { name, version: versionFor(scan.toolVersions, name), invocation: null });
        }
      }
      if (/port/i.test(step.name)) anyPortStage = true;
      execution.push({ host, name: step.name, tools: stageTools, state: step.state, label: stageStateLabel(step.state), reason: step.reason });
      if (isLimitation(step.state)) limitations.push({ host, stage: step.name, label: stageStateLabel(step.state), reason: step.reason });
    }

    for (const artifact of scan.artifacts) {
      const value = obj(artifact.value);
      const hostname = str(value.hostname) ?? str(value.host);
      const url = str(value.url);

      if (HOST_KINDS.has(artifact.kind) && hostname) {
        observed.add(hostname);
        dns.set(hostname, { host: hostname, source: 'Recon artifact' });
      }
      if (artifact.kind === 'port') {
        const port = num(value.port);
        if (port && hostname) {
          network.set(`${hostname}:${port}`, {
            host: hostname,
            port,
            protocol: str(value.protocol),
            service: str(value.service),
            source: 'port artifact',
          });
        }
      }
      if (artifact.kind === 'service') {
        const port = num(value.port);
        const service = str(value.service) ?? str(value.name);
        if (port && hostname) {
          const key = `${hostname}:${port}`;
          const existing = network.get(key);
          network.set(key, { host: hostname, port, protocol: str(value.protocol) ?? existing?.protocol ?? null, service: service ?? existing?.service ?? null, source: 'service artifact' });
        }
      }
      if (artifact.kind === 'endpoint' || url) {
        if (url) {
          endpoints.set(url, { url, status: num(value.statusCode), method: str(value.method) });
          if (num(value.statusCode)) statusCodes.add(num(value.statusCode)!);
          try { responsiveHosts.add(new URL(url).hostname); } catch { /* not a URL we can attribute */ }
          let pathname = '';
          try { pathname = new URL(url).pathname; } catch { pathname = ''; }
          if (artifact.kind === 'api-surface' || /\/api\b|\/v\d+\b/i.test(pathname)) apiSurfaces.add(url);
          if (artifact.kind === 'auth-surface' || /login|signin|auth|oauth|sso/i.test(url)) authSurfaces.add(url);
        }
      }
      if (artifact.kind === 'technology') {
        const name = str(value.name);
        if (name) technologies.set(name, { name, version: str(value.version) });
      }
      if (artifact.kind === 'auth-surface' && (url || hostname)) authSurfaces.add(url ?? hostname!);
      if (artifact.kind === 'api-surface' && (url || hostname)) apiSurfaces.add(url ?? hostname!);
      if (artifact.kind === 'subdomain' && str(value.hostname)) responsiveHosts.add(str(value.hostname)!);
    }
  }

  const stageCounts = { completed: 0, partial: 0, failed: 0, skipped: 0, unknown: 0 };
  for (const line of execution) {
    if (line.state === 'COMPLETED' || line.state === 'COMPLETED_WITH_FALLBACK') stageCounts.completed++;
    else if (line.state === 'PARTIAL' || line.state === 'BLOCKED') stageCounts.partial++;
    else if (line.state === 'FAILED') stageCounts.failed++;
    else if (line.state.startsWith('SKIPPED') || line.state === 'CANCELLED') stageCounts.skipped++;
    else stageCounts.unknown++;
  }

  const changes = facts.scans.map(scan => obj(scan.changeSet)).find(change => Object.keys(change).length > 0);
  const changeCount = (key: string): number => Array.isArray(obj(changes)[key]) ? (obj(changes)[key] as unknown[]).length : 0;
  const changesSection = changes
    ? {
        comparable: changes.comparable === true,
        new: changeCount('new'),
        changed: changeCount('changed'),
        notObserved: changeCount('notObserved'),
        unchanged: changeCount('unchanged'),
        note: changes.comparable === true
          ? 'Compared with the previous retained successful Recon. "Not observed" is not proof of removal.'
          : 'No earlier comparable run; this run is an observation baseline. "Not observed" is not proof of removal.',
      }
    : null;

  const authorized = [...new Set(facts.authorizedAssets)].sort();
  const observedList = [...observed].sort();
  const observedSet = new Set([...observedList, ...endpoints.keys()].map(value => {
    try { return new URL(value).hostname; } catch { return value; }
  }));
  const excluded = facts.program.outOfScope.map(value => value.trim()).filter(Boolean).sort();

  const authenticatedContexts = facts.authSurfaces.flatMap(surface =>
    surface.contexts.map(context => ({ label: context.label, publicObservations: surface.totals.public, authenticatedOnly: surface.totals.authenticatedOnly })),
  );

  return {
    title: `Recon Report — ${facts.program.companyName}`,
    metadata: {
      program: facts.program.companyName,
      platform: facts.program.platform,
      reconDate: iso(facts.run.startedAt ?? facts.run.createdAt),
      duration: durationBetween(facts.run.startedAt ?? facts.run.createdAt, facts.run.finishedAt),
      status: facts.run.status,
      outcomeLabel: overview.label,
      outcomeDetail: overview.detail,
      assessmentMode: facts.program.assessmentMode.toLowerCase().replaceAll('_', ' '),
      hosts: facts.scans.length,
      stageCounts,
    },
    authorization: {
      authorized,
      observed: observedList,
      excluded,
      userAgent: facts.program.requiredUserAgent,
      rules: facts.program.rulesOfEngagement ? redactObservationText(facts.program.rulesOfEngagement) : null,
      note: 'Only explicitly authorized Scope Assets are authorized. Observed hosts are evidence and never grant authorization.',
    },
    methodology: {
      stages: [...new Map(execution.map(line => [line.name, { name: line.name, tools: line.tools }])).values()],
      passiveOnly: execution.length > 0 && execution.every(line => !/port|content|nuclei|active/i.test(line.name)),
      authenticated: authenticatedContexts.length > 0,
    },
    execution,
    tools: [...tools.values()].sort((a, b) => a.name.localeCompare(b.name)),
    dns: [...dns.values()].sort((a, b) => a.host.localeCompare(b.host)),
    network: [...network.values()].sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port),
    portDiscoveryPerformed: anyPortStage,
    web: {
      responsiveHosts: [...responsiveHosts].sort(),
      endpoints: [...endpoints.values()].sort((a, b) => a.url.localeCompare(b.url)),
      technologies: [...technologies.values()].sort((a, b) => a.name.localeCompare(b.name)),
      authSurfaces: [...authSurfaces].sort(),
      apiSurfaces: [...apiSurfaces].sort(),
      statusCodes: [...statusCodes].sort((a, b) => a - b),
    },
    authenticated: {
      contexts: authenticatedContexts,
      note: authenticatedContexts.length
        ? 'Authenticated observations are limited to recorded contexts. Session material is never included.'
        : 'No authenticated Recon context was recorded for this run; the report does not imply authenticated coverage.',
    },
    limitations,
    changes: changesSection,
    researchHandoff: researchHandoff(observedSet, authorized, execution, authenticatedContexts.length, endpoints.size, network.size, changesSection),
    observationsTotal,
  };
}

function stageStateLabel(state: string): string {
  const labels: Record<string, string> = {
    COMPLETED: 'Completed', COMPLETED_WITH_FALLBACK: 'Completed (fallback)', PARTIAL: 'Partial', BLOCKED: 'Blocked',
    FAILED: 'Failed', SKIPPED: 'Skipped', SKIPPED_UNSUPPORTED: 'Unsupported', SKIPPED_NOT_APPLICABLE: 'Not applicable',
    CANCELLED: 'Cancelled', PENDING: 'Pending', RUNNING: 'Running',
  };
  return labels[state] ?? 'Unknown';
}

function isLimitation(state: string): boolean {
  return ['PARTIAL', 'BLOCKED', 'FAILED', 'SKIPPED', 'SKIPPED_UNSUPPORTED', 'SKIPPED_NOT_APPLICABLE', 'CANCELLED'].includes(state);
}

function researchHandoff(observed: Set<string>, authorized: string[], execution: StageLine[], authContexts: number, endpointCount: number, networkCount: number, changes: { new: number } | null): string[] {
  const items: string[] = [];
  const unauthorized = [...observed].filter(host => !authorized.some(pattern => pattern === host || (pattern.startsWith('*.') && host.endsWith(pattern.slice(1)))));
  if (unauthorized.length) items.push(`Observed hosts outside the authorized list (${unauthorized.slice(0, 3).join(', ')}) need explicit authorization before any active review.`);
  if (execution.some(line => line.state === 'PARTIAL' || line.state === 'FAILED' || line.state === 'BLOCKED')) items.push('Some stages were partial or failed; the missing coverage is unknown and needs follow-up.');
  if (authContexts === 0) items.push('No authenticated context was recorded; authenticated behaviour remains untested.');
  if (endpointCount > 0) items.push(`${endpointCount} web endpoint${endpointCount === 1 ? '' : 's'} observed; access control still needs manual review.`);
  if (networkCount === 0) items.push('No port or service observation was recorded; the network surface remains unknown.');
  if (changes && changes.new > 0) items.push(`${changes.new} new observation${changes.new === 1 ? '' : 's'} compared with the previous Recon.`);
  if (!items.length) items.push('No evidence-backed priority stands out; consider expanding authorized scope or re-running Recon.');
  return items;
}
