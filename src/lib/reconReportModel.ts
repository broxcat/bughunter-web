/**
 * Deterministic Recon report.
 *
 * Every value here is derived from persisted execution evidence. Nothing is
 * inferred: a port appears only when a port artifact was recorded, a tool only
 * when an actual provider attempt was recorded, and an invocation only when it was stored.
 * This model is authoritative; any AI narrative is a separate, optional layer.
 */
import { buildReportEvidence } from './reconReportEvidence';
import { reconOverview } from './reconOverview';
import { providerAttempts } from './reconTimeline';
import { redactObservationText } from './observationSafety';
import { buildHostReportSection, type HostReportSection } from './reconHostReport';

export type ReportStep = { id?: string; name: string; state: string; reason: string | null; details: unknown };

export type ReportArtifact = { id?: string; sources?: unknown; scopeState?: string; firstSeenAt?: string; lastSeenAt?: string; kind: string; verification?: string; value: Record<string, unknown> };

export type ReportScan = {
  id?: string;
  scopeAssetId?: string | null;
  host: string | null;
  status: string;
  outcome: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  requiredUserAgent: string | null;
  authenticatedContexts: number;
  plan: { activityMode?: 'PASSIVE' | 'ACTIVE'; boundary?: { normalizedValue?: string }; authorization?: { exclusions?: string[] }; stages?: Array<{ name: string; tools?: string[] }> } | null;
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
  authSurfaces: Array<{ observations?:Array<{id:string;scanRunId:string;url:string;method:string;source:string;observedAt:string;responseClass:string;contextLabel:string}>; contexts: Array<{ label: string; mode: string; state: string; observations: number }>; totals: { public: number; authenticatedOnly: number; sharedAuthenticated: number; observations: number } }>;
};

export type StageLine = { host: string; name: string; tools: string[]; state: string; label: string; reason: string | null };

export type ReconReportModel = ReturnType<typeof buildReportEvidence> & {
  report: HostReportSection;
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
  authorization: { authorized: string[]; observed: string[]; excluded: string[]; userAgent: string | null; exclusionsRecorded: boolean; rules: string | null; note: string };
  methodology: { stages: Array<{ name: string; tools: string[] }>; passiveOnly: boolean; activity: 'PASSIVE' | 'ACTIVE' | 'UNKNOWN'; authenticated: boolean };
  execution: StageLine[];
  tools: Array<{ name: string; version: string | null; invocation: string | null }>;
  dns: Array<{ host: string; source: string }>;
  network: Array<{ host: string; port: number; protocol: string | null; service: string | null; state: string | null; source: string }>;
  portDiscoveryPerformed: boolean;
  web: {
    responsiveHosts: string[];
    endpoints: Array<{ url: string; status: number | null; method: string | null }>;
    technologies: Array<{ name: string; version: string | null }>;
    authSurfaces: string[];
    apiSurfaces: string[];
    statusCodes: number[];
  };
  authenticated: { contexts: Array<{ label: string; state: string; observations: number }>; note: string | null };
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
  return str(record[tool]) ?? str(obj(record[tool]).version);
}

export function buildReconReportModel(facts: ReportFacts): ReconReportModel {
  const overview = reconOverview({ status: facts.run.status, outcome: facts.run.outcome });

  const execution: StageLine[] = [];
  const tools = new Map<string, { name: string; version: string | null; invocation: string | null }>();
  const dns = new Map<string, { host: string; source: string }>();
  const network = new Map<string, { host: string; port: number; protocol: string | null; service: string | null; state: string | null; source: string }>();
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
    const host = str(scan.host) ?? 'Unknown host';
    if (scan.artifactCount > scan.artifacts.length) limitations.push({ host, stage: 'Report inventory', label: 'Truncated', reason: `${scan.artifacts.length} of ${scan.artifactCount} retained artifacts included; consult the artifact API for the complete inventory.` });
    observationsTotal += scan.artifactCount;


    for (const step of scan.steps) {
      const stageTools = [...new Set(providerAttempts(step.details).map(attempt => attempt.provider))];
      for (const tool of stageTools) {
        if (typeof tool === 'string' && tool.trim()) {
          const name = tool.trim();
          tools.set(name, { name, version: versionFor(scan.toolVersions, name), invocation: null });
        }
      }
      if (/port/i.test(step.name) && ['RUNNING', 'COMPLETED', 'COMPLETED_WITH_FALLBACK', 'PARTIAL'].includes(step.state)) anyPortStage = true;
      execution.push({ host, name: step.name, tools: stageTools, state: step.state, label: stageStateLabel(step.state), reason: str(step.reason) });
      if (isLimitation(step.state)) limitations.push({ host, stage: step.name, label: stageStateLabel(step.state), reason: str(step.reason) });
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
        if (port && Number.isInteger(port) && port > 0 && port <= 65535 && hostname) {
          network.set(`${hostname}:${port}:${str(value.protocol)??"unrecorded"}`, {
            host: hostname,
            port,
            protocol: str(value.protocol),
            service: str(value.service),
            state: str(value.state),
            source: 'port artifact',
          });
        }
      }
      if (artifact.kind === 'service') {
        const port = num(value.port);
        const service = str(value.service) ?? str(value.name);
        if (port && Number.isInteger(port) && port > 0 && port <= 65535 && hostname) {
          const key = `${hostname}:${port}:${str(value.protocol)??"unrecorded"}`;
          const existing = network.get(key);
          network.set(key, { host: hostname, port, protocol: str(value.protocol) ?? existing?.protocol ?? null, service: service ?? existing?.service ?? null, state: str(value.state) ?? existing?.state ?? null, source: 'service artifact' });
        }
      }
      if (artifact.kind === 'endpoint' || url) {
        if (url) {
          endpoints.set(url, { url, status: num(value.statusCode), method: str(value.method) });
          if (num(value.statusCode)) statusCodes.add(num(value.statusCode)!);
          if (artifact.verification === 'OBSERVED' && num(value.statusCode) !== null) {
            try { responsiveHosts.add(new URL(url).hostname); } catch { /* unattributable URL */ }
          }
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

  const changes = facts.scans.map(scan => obj(scan.changeSet)).filter(change => Object.keys(change).length > 0);
  const changeCount = (key: string): number => changes.reduce((sum, change) => sum + (Array.isArray(change[key]) ? change[key].length : 0), 0);
  const comparable = changes.length === facts.scans.length && changes.every(change => change.comparable === true || typeof change.previousScanId === 'string');
  const changesSection = changes.length
    ? {
        comparable,
        new: changeCount('new'),
        changed: changeCount('changed'),
        notObserved: changeCount('notObserved'),
        unchanged: changeCount('unchanged'),
        note: comparable
          ? 'Aggregated across host executions with retained comparisons. "Not observed" is not proof of removal.'
          : 'Some host executions lack a comparable baseline; totals include only recorded changes. "Not observed" is not proof of removal.',
      }
    : null;

  const authorized = [...new Set(facts.authorizedAssets)].sort();
  const observedList = [...observed].sort();
  const observedSet = new Set([...observedList, ...endpoints.keys()].map(value => {
    try { return new URL(value).hostname; } catch { return value; }
  }));
  const excluded = facts.program.outOfScope.map(value => value.trim()).filter(Boolean).sort();

  const authenticatedContexts = facts.authSurfaces.flatMap(surface =>
    surface.contexts.filter(context => context.mode === 'AUTHENTICATED').map(context => ({ label: context.label, state: context.state, observations: context.observations })),
  );

  const activity = facts.scans.length && facts.scans.every(scan => scan.plan?.activityMode === 'PASSIVE') ? 'PASSIVE' : facts.scans.some(scan => scan.plan?.activityMode === 'ACTIVE') ? 'ACTIVE' : 'UNKNOWN';
  const result: ReconReportModel = {
    ...buildReportEvidence(facts),
    report: buildHostReportSection(facts),
    title: `Rapport de reconnaissance — ${facts.program.companyName}`,
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
      exclusionsRecorded: facts.scans.length>0&&facts.scans.every(scan=>Array.isArray(scan.plan?.authorization?.exclusions)),
      rules: facts.program.rulesOfEngagement ? redactObservationText(facts.program.rulesOfEngagement) : null,
      note: 'Captured execution boundaries only; unrecorded historical policy stays unknown. Engagement rules were not captured here. Review current Target Scope before new work. Observations never grant authorization.',
    },
    methodology: {
      stages: [...new Map(facts.scans.flatMap(scan => scan.plan?.stages ?? []).map(stage => [stage.name, { name: stage.name, tools: stage.tools ?? [] }])).values()],
      passiveOnly: activity === 'PASSIVE',
      activity,
      authenticated: authenticatedContexts.some(context => context.observations > 0),
    },
    execution,
    tools: [...tools.values()].sort((a, b) => a.name.localeCompare(b.name)),
    dns: [...dns.values()].sort((a, b) => a.host.localeCompare(b.host)),
    network: [...network.values()].sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port || (a.protocol??'').localeCompare(b.protocol??'')),
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
        ? 'Captured authentication contexts include their recorded state and usable observation count. Planned or unavailable contexts do not imply tested coverage. Session material is never included.'
        : 'No authenticated Recon context was included in the available captured report evidence; the report does not imply authenticated coverage.',
    },
    limitations,
    changes: changesSection,
    researchHandoff: researchHandoff(observedSet, authorized, execution, authenticatedContexts.filter(context => context.observations > 0).length, endpoints.size, network.size, changesSection),
    observationsTotal,
  };
  // Apply the same credential boundary to every display field, including
  // program metadata, stage names, versions, reasons and authentication labels.
  return scrubReport(result);
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
  if (authContexts === 0) items.push('No usable authenticated observation was recorded; authenticated behaviour remains untested.');
  if (endpointCount > 0) items.push(`${endpointCount} web URL${endpointCount === 1 ? '' : 's'} recorded; verify availability and access control manually.`);
  if (networkCount === 0) items.push('No port or service observation was recorded; the network surface remains unknown.');
  if (changes && changes.new > 0) items.push(`${changes.new} new observation${changes.new === 1 ? '' : 's'} compared with the previous Recon.`);
  if (!items.length) items.push('No evidence-backed priority stands out; consider expanding authorized scope or re-running Recon.');
  return items;
}

function scrubReport<T>(value: T): T {
  if (typeof value === 'string') return redactObservationText(value) as T;
  if (Array.isArray(value)) return value.map(item => scrubReport(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubReport(item)])) as T;
  return value;
}
