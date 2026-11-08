import { prisma } from '@/lib/prisma';
import { redactEvidenceText } from '@/lib/evidenceVault';
import { researchDataSchema } from '@/lib/research/hypotheses';
import { canPrepareResearchHunt, type HarnessSource, type ResearchStage } from '@/lib/research/workflow';
import { coverageView } from './coverage';
import { researchPlanState } from './plans';
import { reconScopePolicy } from './reconPolicy';
import { assertResearchTarget, exportText, researchAuthorizationMatches, ResearchError, researchIsPassive, researchTargetSelect } from './workspace';

export function harnessText(value: string, limit = 1200) {
  return redactEvidenceText(exportText(value)).slice(0, limit);
}

export async function ownedHarnessSession(userId: string, targetId: string) {
  const target = await prisma.target.findFirst({ where: { id: targetId, userId, program: { ownerId: userId } }, select: researchTargetSelect });
  if (!target) throw new ResearchError('Target not found', 404);
  assertResearchTarget(target, userId);
  if (researchIsPassive(target)) throw new ResearchError('Open an authorized host console to run Research.', 409);
  const session = await prisma.researchSession.findUnique({ where: { consoleTargetId: targetId },
    select: { id: true, userId: true, status: true, authorizationSnapshot: true },
  });
  if (session?.userId !== userId || session.status !== 'READY') throw new ResearchError('Open the Research console before running a stage.', 409);
  if (!researchAuthorizationMatches(session.authorizationSnapshot, target)) throw new ResearchError('Research authorization changed. Open a current workspace.', 409);
  return { target, session };
}

type Source = Omit<HarnessSource, 'id'>;
const indexed = (sources: Source[], prefix: string) => sources.map((source, i) => ({ ...source, id: prefix + (i + 1) }));

export async function captureHarnessContext(userId: string, targetId: string, input: ResearchStage) {
  const { target, session } = await ownedHarnessSession(userId, targetId);
  const policy = reconScopePolicy(target);
  const state = await researchPlanState(userId, targetId);
  const plan = state.plan;
  const objective = input.stage === 'hunt' && plan?.id === input.planId
    ? plan.items.find(item => item.id === input.objectiveId && item.status === 'READY') : undefined;
  if (input.stage === 'hunt' && (!objective || !canPrepareResearchHunt(targetId, plan, state) || !policy.activeSuggestionsAllowed)) {
    throw new ResearchError('Use the current captured plan and an authorized objective before preparing a test.', 409);
  }
  let subject = input.stage === 'hunt' ? `${input.planId}:${input.objectiveId}` : plan?.id ?? 'initial';
  let query = objective ? `${objective.title} ${objective.objective} ${objective.rationale}` : 'Map observed web surfaces, authentication and trust boundaries. Find missing evidence.';
  const facts: Source[] = [];
  const objectives = objective ? [objective] : input.stage === 'map' ? (plan?.items ?? []).filter(item => item.status === 'READY').slice(0, 5) : [];
  for (const item of objectives) {
    const surfaces = item.surfaceRefs.filter(surface => policy.inScope(surface.url)).slice(0, 4);
    facts.push({ label: 'Captured Research objective', reference: item.id,
      text: harnessText(`${item.title}\n${item.objective}\n${item.rationale}\n${surfaces.map(s => [s.method, s.url].filter(Boolean).join(' ')).join('\n')}\nReferences: ${item.evidenceRefs.slice(0, 4).join(', ')}`) });
  }

  if (input.stage === 'validate' || input.stage === 'trace') {
    if (input.sessionId !== session.id) throw new ResearchError('Hypothesis session not found', 404);
    const h = await prisma.researchHypothesis.findFirst({ where: { id: input.hypothesisId, sessionId: session.id },
      select: { revision: true, contentSha256: true, externalId: true, hypothesis: true, falsificationCondition: true, researchData: true },
    });
    if (!h) throw new ResearchError('Hypothesis not found', 404);
    if (h.revision !== input.revision) throw new ResearchError('Reload the current hypothesis revision.', 409);
    const result = researchDataSchema.safeParse(h.researchData);
    if (!result.success || !result.data.tests.length) throw new ResearchError('Sync a v2 hypothesis with recorded tests before requesting a review.', 409);
    const proof = result.data;
    if (proof.targetId !== targetId || proof.host !== target.host || proof.location && !policy.inScope(proof.location)) throw new ResearchError('Hypothesis evidence is outside the current scope.', 409);
    subject = `${input.hypothesisId}:${input.revision}:${h.contentSha256}`;
    query = `${h.hypothesis}\n${proof.suspectedImpact}\n${proof.location ?? ''}`;
    facts.push({ label: 'Research hypothesis', reference: h.externalId,
      text: harnessText(`${h.hypothesis}\nCounterexample to look for: ${h.falsificationCondition}\nPrerequisites: ${proof.prerequisites.join(', ')}`) });
    const scoped = (obs: { host: string; location: string | null }) => obs.host === target.host && (!obs.location || policy.inScope(obs.location));
    for (const test of proof.tests.slice(-6)) {
      const control = test.negativeControl;
      const controls = control.kind === 'PERFORMED' ? control.observations : [];
      if (![...test.observations, ...controls].every(scoped)) continue;
      const captures = [...test.observations, ...controls].flatMap(obs => obs.evidence.map(item => item.ref)).slice(0, 8);
      facts.push({ label: 'Recorded test and controls', reference: `${h.externalId}/${test.id} (${captures.join(', ')})`,
        text: harnessText(`Outcome claimed: ${test.outcome}. Reproduced: ${test.reproduced}. Effect claimed: ${test.securityEffect}\nReproduction: ${test.reproductionSteps.join(' ')}\nNegative control: ${control.kind}. ${control.kind === 'PERFORMED' ? control.significance : control.reason}\nObserved: ${test.observations.map(o => o.summary).join(' ')}\nControl observations: ${controls.map(o => o.summary).join(' ')}`) });
    }
    if (facts.length < 2) throw new ResearchError('The current scope has no usable recorded tests.', 409);
  }

  const [coverage, recon, findings] = await Promise.all([
    prisma.$transaction(tx => coverageView(tx, userId, targetId, plan)),
    prisma.reconArtifact.findMany({
      where: { scopeState: 'IN_SCOPE', scanRun: { targetId, type: 'RECON', status: 'COMPLETED', ...(plan ? { id: plan.scanRunId } : {}) } },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }], take: 16,
      select: { id: true, kind: true, value: true, verification: true, lastSeenAt: true },
    }),
    prisma.finding.findMany({ where: { targetId }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 8,
      select: { id: true, title: true, location: true, reviewStatus: true, lifecycle: true, vulnClass: true },
    }),
  ]);
  const corpus: Source[] = [];
  for (const review of (coverage.reviewMemory ?? []).slice(0, 10)) {
    corpus.push({ label: 'Prior human decision', reference: `${review.sessionId}/${review.externalId} revision ${review.revision}`,
      text: harnessText(`${review.objectiveKey} · ${review.verdict} · ${review.reason}. ${review.finding ? 'Current Finding review: '+review.finding.reviewStatus+' / '+(review.finding.lifecycle ?? 'historical') : ''}`) });
  }
  for (const entry of coverage.entries.filter(item => policy.inScope(item.surface)).sort((a, b) =>
    (b.events[0]?.createdAt ?? '').localeCompare(a.events[0]?.createdAt ?? '')).slice(0, 12)) {
    corpus.push({ label: 'Prior test coverage', reference: entry.id,
      text: harnessText(`${entry.objectiveKey} · ${entry.method} ${entry.surface} · ${entry.contextLabel} ${entry.comparisonLabel ?? ''} · ${entry.state}. ${entry.events[0]?.action ?? ''} ${entry.events[0]?.result ?? ''}`) });
  }
  for (const finding of findings) {
    if (!finding.location || !policy.inScope(finding.location)) continue;
    corpus.push({ label: 'Prior Finding', reference: finding.id,
      text: harnessText(`${finding.title} · ${finding.vulnClass ?? ''} · ${finding.location} · ${finding.reviewStatus} / ${finding.lifecycle ?? 'historical'}`) });
  }
  for (const observation of recon) {
    const value = observation.value as { url?: unknown; method?: unknown } | null;
    if (typeof value?.url !== 'string' || !policy.inScope(value.url)) continue;
    const source = { label: 'Recon observation', reference: observation.id,
      text: harnessText(`${observation.kind} · ${typeof value.method === 'string' ? value.method : ''} ${value.url} · ${observation.verification} · ${observation.lastSeenAt.toISOString()}`) };
    if (input.stage === 'map' && facts.length < 5) facts.push(source);
    else corpus.push(source);
  }
  return { sessionId: session.id, subject, query: harnessText(query, 2000), facts: indexed(facts, 'F'), corpus: indexed(corpus, 'M') };
}
