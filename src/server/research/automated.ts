import type { Prisma } from '@prisma/client';
import { canonicalReconUrl } from '@/lib/reconArtifacts';
import { isSafeReadUrl, safeObservationUrl } from '@/lib/observationSafety';
import type { ResearchPlanView } from '@/lib/researchPlanView';
import { prisma } from '@/lib/prisma';
import { loadTargetExecution, withTargetExecution } from '../execution';
import { authorizeExecution } from '../programExecutionPolicy';
import { throwIfScanAborted } from '../scanControl';
import { probe } from '../scanners/http';
import type { ScanExecutionResult } from '../scanners/result';
import { captureResearchPlanForTarget } from './plans';

const tool = 'research-read-only';
const maxRequests = 12;
const readOnlyObjectives = new Set([
  'AUTHENTICATION', 'SESSION_MANAGEMENT', 'API', 'API_VERSIONING', 'GRAPHQL', 'REDIRECT_HANDLING',
]);
type Observation = { url: string; method: string; statusCode: number | null };
type Result =
  | { status: 'NOT_TESTED' | 'UNAVAILABLE'; reason: string }
  | { status: 'OBSERVED'; method: string; url: string; previousStatus: number | null; statusCode: number;
      authChallenge: boolean; setsCookie: boolean; hsts: boolean; contentSecurityPolicy: boolean;
      redirect: 'none' | 'same origin' | 'different origin' | 'unparseable' };

function requestKey(url: string, method: string) {
  return method + ' ' + canonicalReconUrl(url);
}

function candidateUrl(value: string) {
  try {
    const url = new URL(value);
    canonicalReconUrl(value);
    return !url.search && !url.hash && !/[%;\\]|\/{2}|\*/.test(url.pathname) &&
      safeObservationUrl(value) === value && isSafeReadUrl(value);
  } catch { return false; }
}

export function selectResearchRequests(plan: ResearchPlanView, observed: Observation[]) {
  const anonymous = new Map<string, Observation>();
  for (const row of observed) {
    if (!['GET', 'HEAD'].includes(row.method) || !candidateUrl(row.url)) continue;
    const key = requestKey(row.url, row.method);
    if (!anonymous.has(key)) anonymous.set(key, row);
  }
  return plan.items.map((item): { item: ResearchPlanView['items'][number]; observation?: Observation; reason?: string } => {
    if (item.status !== 'READY') return { item, reason: 'Excluded by the program.' };
    if (!readOnlyObjectives.has(item.category) || item.contextRefs.some(context => context.contextKey !== 'ANONYMOUS')) return { item, reason: 'This objective needs a manual test or a test account.' };
    for (const surface of item.surfaceRefs) {
      if (!surface.method || surface.pattern || surface.requestable === false || !candidateUrl(surface.url)) continue;
      const observation = anonymous.get(requestKey(surface.url, surface.method));
      if (observation) return { item, observation };
    }
    return { item, reason: 'No exact anonymous read-only request was observed in this Recon.' };
  });
}

function redirectKind(url: string, value: string | undefined) {
  if (!value) return 'none' as const;
  try { return new URL(value, url).origin === new URL(url).origin ? 'same origin' as const : 'different origin' as const; }
  catch { return 'unparseable' as const; }
}

export async function runAutomatedResearch(runId: string): Promise<ScanExecutionResult> {
  const run = await prisma.scanRun.findUniqueOrThrow({ where: { id: runId }, select: {
    targetId: true, type: true, researchKey: true, researchHandoffId: true, scopeAssetId: true, scopeAssetSnapshot: true,
    target: { select: { userId: true, programId: true, discoveredFromAssetId: true, program: { select: { campaign: { select: { state: true, handoffRunId: true } } } } } },
    researchSource: { select: { id: true, type: true, status: true, outcome: true, targetReconRunId: true, scopeAssetId: true,
      target: { select: { programId: true, userId: true } }, scopeAsset: { select: { active: true, format: true, normalizedValue: true } } } },
  } });
  const { researchSource: source, target } = run;
  const campaign = target.program?.campaign;
  const snapshot = run.scopeAssetSnapshot as { format?: string; normalizedValue?: string } | null;
  if (run.type !== 'RESEARCH' || !run.researchKey || !source?.targetReconRunId || source.type !== 'RECON' ||
      source.status !== 'COMPLETED' || !['SUCCESS', 'PARTIAL'].includes(source.outcome ?? '') ||
      source.target.programId !== target.programId || source.target.userId !== target.userId ||
      !run.researchHandoffId || campaign?.handoffRunId !== run.researchHandoffId || !['RESEARCH_PENDING', 'RESEARCH_RUNNING', 'PAUSED'].includes(campaign.state) ||
      !run.scopeAssetId || source.scopeAssetId !== run.scopeAssetId || !source.scopeAsset?.active ||
      snapshot?.format !== source.scopeAsset.format || snapshot.normalizedValue !== source.scopeAsset.normalizedValue) {
    return { outcome: 'FAILED', reason: 'The current scope or campaign no longer authorizes this Research job.' };
  }

  const publication = await prisma.$transaction(tx => captureResearchPlanForTarget(tx, target.userId, run.targetId,
    { scanRunId: source.id }), { timeout: 30000 });
  throwIfScanAborted();
  const entries: { objectiveId: string; result: Result }[] = [];
  let note: string | null = null;
  const save = () => prisma.scanRun.update({ where: { id: runId }, data: {
    executedResearchPlanId: publication?.id,
    researchResults: { version: 1, note, entries } satisfies Prisma.InputJsonObject,
  } });
  if (!publication?.plan.items.length) {
    note = 'Recon did not provide a Research objective for this asset.';
    await save();
    return { outcome: 'PARTIAL', reason: note };
  }
  const plan = publication.plan;
  await save();
  const wildcardOnly = source.scopeAsset.format === 'WILDCARD_DOMAIN' && target.discoveredFromAssetId !== run.scopeAssetId;
  if (wildcardOnly) {
    note = 'Wildcard inventory is passive. Requests require a concrete host with observed Recon traffic.';
    for (const item of plan.items) entries.push({ objectiveId: item.id, result: { status: 'NOT_TESTED', reason: note } });
    await save();
    return { outcome: 'PARTIAL', reason: note };
  }
  const execution = await loadTargetExecution(run.targetId);
  const boundary = execution.scopeAsset ?? execution.parentScopeAsset;
  if (execution.programId !== target.programId || !execution.policy?.version || boundary?.id !== run.scopeAssetId ||
      boundary.normalizedValue !== snapshot.normalizedValue || boundary.format !== snapshot.format) {
    return { outcome: 'FAILED', reason: 'The execution policy or Scope Asset changed before Research started.' };
  }
  await prisma.scanRun.update({ where: { id: runId }, data: { requiredUserAgent: execution.requiredUserAgent } });
  const observations = await prisma.reconSurfaceObservation.findMany({ where: {
    scanRunId: source.id, scopeAssetId: run.scopeAssetId, contextType: 'ANONYMOUS', urlRedacted: false,
    source: 'anonymous-recon', statusCode: { gte: 200, lt: 500, notIn: [404, 410, 429] },
  }, orderBy: [{ url: 'asc' }, { method: 'asc' }, { id: 'asc' }], take: 2000,
  select: { url: true, method: true, statusCode: true } });
  const cached = new Map<string, Result>();
  let stopped = false;
  for (const { item, observation, reason } of selectResearchRequests(plan, observations)) {
    throwIfScanAborted();
    let result: Result = { status: 'NOT_TESTED', reason: reason ?? 'Request was outside the current authorization.' };
    if (observation) {
      const { url, method } = observation;
      const key = method + ' ' + url;
      const previous = cached.get(key);
      if (previous) result = previous;
      else if (stopped || cached.size >= maxRequests) {
        result = { status: 'NOT_TESTED', reason: stopped ? 'Stopped after a network error, rate limit or server error.' : 'Research request budget reached.' };
      } else {
        try {
          authorizeExecution(execution, { tool, url });
          const page = await withTargetExecution(execution, () => probe(url, { tool, method, timeoutMs: 8000, maxBodyBytes: 0 }));
          if (page.error || !page.status) result = { status: 'UNAVAILABLE', reason: 'The authorized request did not return a usable response.' };
          else result = {
            status: 'OBSERVED', method, url, previousStatus: observation.statusCode, statusCode: page.status,
            authChallenge: Boolean(page.headers['www-authenticate']), setsCookie: Boolean(page.headers['set-cookie']),
            hsts: Boolean(page.headers['strict-transport-security']), contentSecurityPolicy: Boolean(page.headers['content-security-policy']),
            redirect: redirectKind(url, page.headers.location),
          };
          stopped = Boolean(page.error) || page.status === 429 || page.status >= 500;
        } catch {
          throwIfScanAborted();
          result = { status: 'NOT_TESTED', reason: 'Blocked by the current Scope or test categories.' };
        }
        cached.set(key, result);
      }
    }
    entries.push({ objectiveId: item.id, result });
    // Keep each completed observation if the worker stops mid-plan.
    await save();
  }
  if (!stopped && entries.every(entry => entry.result.status === 'OBSERVED')) return { outcome: 'SUCCESS' };
  return { outcome: 'PARTIAL', reason: 'Some objectives require review, were blocked, or had no usable response.' };
}
