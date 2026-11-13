import { prisma } from '@/lib/prisma';
import { redactEvidenceText } from '@/lib/evidenceVault';
import { researchDataSchema } from '@/lib/research/hypotheses';
import { savedResearchReview } from '@/lib/research/humanReview';
import type { HarnessSource, ResearchStage } from '@/lib/research/workflow';
import { reconScopePolicy } from './reconPolicy';
import { createResearchSession } from './sessions';
import {
  assertResearchTarget,
  exportText,
  ResearchError,
  researchTargetSelect,
} from './workspace';

export function harnessText(value: string, limit = 1200) {
  return redactEvidenceText(exportText(value)).slice(0, limit);
}

export async function ownedHarnessSession(userId: string, targetId: string) {
  const target = await prisma.target.findFirst({
    where: { id: targetId, userId, program: { ownerId: userId } },
    select: researchTargetSelect,
  });
  if (!target) throw new ResearchError('Target not found', 404);
  assertResearchTarget(target, userId);
  const recon = await prisma.scanRun.findFirst({
    where: { targetId, type: 'RECON', status: 'COMPLETED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  if (!recon) throw new ResearchError('Run Recon before starting Research.', 409);
  const session = await createResearchSession(userId, targetId);
  return { target, session };
}

type Source = Omit<HarnessSource, 'id'>;
const indexed = (sources: Source[], prefix: string) => sources.map((source, index) => ({ ...source, id: prefix + (index + 1) }));

export async function captureHarnessContext(userId: string, targetId: string, input: ResearchStage) {
  const { target, session } = await ownedHarnessSession(userId, targetId);
  const policy = reconScopePolicy(target);
  let subject = session.reconScanRunId ?? 'initial';
  let query = 'Map observed web surfaces, authentication and trust boundaries. Identify missing evidence without proposing unapproved target interaction.';
  const facts: Source[] = [];
  let humanSupported = false;

  if (input.stage === 'validate' || input.stage === 'trace') {
    if (input.sessionId !== session.id) throw new ResearchError('Hypothesis session not found', 404);
    const hypothesis = await prisma.researchHypothesis.findFirst({
      where: { id: input.hypothesisId, sessionId: session.id },
      select: { revision: true, contentSha256: true, externalId: true, hypothesis: true, falsificationCondition: true, researchData: true },
    });
    if (!hypothesis) throw new ResearchError('Hypothesis not found', 404);
    if (hypothesis.revision !== input.revision) throw new ResearchError('Reload the current hypothesis revision.', 409);
    if (input.stage === 'trace') {
      const revision = await prisma.researchHypothesisRevision.findUnique({
        where: { hypothesisId_revision: { hypothesisId: input.hypothesisId, revision: hypothesis.revision } },
        select: { humanReview: true },
      });
      humanSupported = savedResearchReview.safeParse(revision?.humanReview).data?.verdict === 'SUPPORTED';
    }
    const result = researchDataSchema.safeParse(hypothesis.researchData);
    if (!result.success || !result.data.tests.length) throw new ResearchError('Recorded structured tests are required before requesting a review.', 409);
    const proof = result.data;
    if (proof.targetId !== targetId || proof.host !== target.host || (proof.location && !policy.inScope(proof.location))) {
      throw new ResearchError('Hypothesis evidence is outside the current scope.', 409);
    }
    subject = input.hypothesisId + ':' + input.revision + ':' + hypothesis.contentSha256;
    query = hypothesis.hypothesis + '\n' + proof.suspectedImpact + '\n' + (proof.location ?? '');
    facts.push({
      label: 'Research hypothesis',
      reference: hypothesis.externalId,
      text: harnessText(hypothesis.hypothesis + '\nCounterexample to look for: ' + hypothesis.falsificationCondition + '\nPrerequisites: ' + proof.prerequisites.join(', ')),
    });
    const scoped = (observation: { host: string; location: string | null }) =>
      observation.host === target.host && (!observation.location || policy.inScope(observation.location));
    for (const test of proof.tests.slice(-6)) {
      const control = test.negativeControl;
      const controls = control.kind === 'PERFORMED' ? control.observations : [];
      if (![...test.observations, ...controls].every(scoped)) continue;
      const captures = [...test.observations, ...controls].flatMap(observation => observation.evidence.map(item => item.ref)).slice(0, 8);
      facts.push({
        label: 'Recorded test and controls',
        reference: hypothesis.externalId + '/' + test.id + ' (' + captures.join(', ') + ')',
        text: harnessText('Outcome claimed: ' + test.outcome + '. Reproduced: ' + test.reproduced + '. Effect claimed: ' + test.securityEffect +
          '\nReproduction: ' + test.reproductionSteps.join(' ') +
          '\nNegative control: ' + control.kind + '. ' + (control.kind === 'PERFORMED' ? control.significance : control.reason) +
          '\nObserved: ' + test.observations.map(observation => observation.summary).join(' ') +
          '\nControl observations: ' + controls.map(observation => observation.summary).join(' ')),
      });
    }
    if (facts.length < 2) throw new ResearchError('The current scope has no usable recorded tests.', 409);
  }

  const [recon, findings] = await Promise.all([
    prisma.reconArtifact.findMany({
      where: {
        scopeState: 'IN_SCOPE',
        scanRun: { id: session.reconScanRunId ?? undefined, targetId, type: 'RECON', status: 'COMPLETED' },
      },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }],
      take: 24,
      select: { id: true, kind: true, value: true, verification: true, lastSeenAt: true },
    }),
    prisma.finding.findMany({
      where: { targetId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 8,
      select: { id: true, title: true, location: true, reviewStatus: true, lifecycle: true, vulnClass: true },
    }),
  ]);
  const corpus: Source[] = [];
  for (const finding of findings) {
    if (!finding.location || !policy.inScope(finding.location)) continue;
    corpus.push({
      label: 'Prior Finding',
      reference: finding.id,
      text: harnessText(finding.title + ' · ' + (finding.vulnClass ?? '') + ' · ' + finding.location + ' · ' + finding.reviewStatus + ' / ' + (finding.lifecycle ?? 'historical')),
    });
  }
  for (const observation of recon) {
    const value = observation.value as { url?: unknown; method?: unknown } | null;
    if (typeof value?.url !== 'string' || !policy.inScope(value.url)) continue;
    const source = {
      label: 'Recon observation',
      reference: observation.id,
      text: harnessText(observation.kind + ' · ' + (typeof value.method === 'string' ? value.method : '') + ' ' + value.url + ' · ' + observation.verification + ' · ' + observation.lastSeenAt.toISOString()),
    };
    if (input.stage === 'map' && facts.length < 8) facts.push(source);
    else corpus.push(source);
  }
  return {
    sessionId: session.id,
    subject,
    humanSupported,
    query: harnessText(query, 2000),
    facts: indexed(facts, 'F'),
    corpus: indexed(corpus, 'M'),
  };
}
