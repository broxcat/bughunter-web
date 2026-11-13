import { prisma } from '@/lib/prisma';
import { paginationBounds } from '@/lib/pagination';
import {
  HYPOTHESIS_STATUSES,
  researchDataSchema,
  type HypothesisStatus,
  type ResearchHypothesisInput,
} from '@/lib/research/hypotheses';
import { exportText } from './workspace';
import { ownedResearch } from './sessions';

export class HypothesisSyncError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public issues: { path: string; message: string }[] = [],
  ) { super(message); }
}

function safeResearchRead<T>(value: T): T {
  if (typeof value === 'string') return exportText(value) as T;
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(safeResearchRead) as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeResearchRead(item)])) as T;
}

export function hypothesisSnapshot(hypothesis: ResearchHypothesisInput) {
  const sanitize = (value: unknown): unknown =>
    typeof value === 'string' ? exportText(value)
      : Array.isArray(value) ? value.map(sanitize)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, value]) => [key, sanitize(value)]))
      : value;
  const researchData = 'targetId' in hypothesis
    ? researchDataSchema.parse(sanitize(Object.fromEntries(Object.keys(researchDataSchema.shape).map(key => [key, hypothesis[key as keyof typeof hypothesis]]))))
    : undefined;
  return {
    ...(researchData ? { researchData } : {}),
    externalId: hypothesis.externalId,
    title: exportText(hypothesis.title),
    status: hypothesis.status,
    hypothesis: exportText(hypothesis.hypothesis),
    evidenceFor: hypothesis.evidenceFor.map(evidence => ({ ref: evidence.ref, summary: exportText(evidence.summary) })),
    evidenceAgainst: hypothesis.evidenceAgainst.map(evidence => ({ ref: evidence.ref, summary: exportText(evidence.summary) })),
    nextTest: exportText(hypothesis.nextTest),
    expectedSignal: exportText(hypothesis.expectedSignal),
    falsificationCondition: exportText(hypothesis.falsificationCondition),
    confidence: hypothesis.confidence ?? null,
    tags: [...new Set(hypothesis.tags.map(exportText))].sort(),
    notes: hypothesis.notes ? exportText(hypothesis.notes) : null,
    blockedReason: hypothesis.blockedReason ? exportText(hypothesis.blockedReason) : null,
  };
}

export async function ownedHypothesisSession(sessionId: string, userId: string) {
  const session = await prisma.researchSession.findFirst({
    where: { id: sessionId, ...ownedResearch(userId) },
    select: { id: true, activeTargetId: true, targetId: true, status: true, authorizationSnapshot: true },
  });
  if (!session) throw new HypothesisSyncError('NOT_FOUND', 'Research session not found', 404);
  return session;
}

export function sortHypotheses<T extends { status: HypothesisStatus; externalId: string; createdAt: Date; id?: string }>(rows: T[]) {
  return rows.sort((a, b) =>
    HYPOTHESIS_STATUSES.indexOf(a.status) - HYPOTHESIS_STATUSES.indexOf(b.status) ||
    Number(a.externalId.slice(2)) - Number(b.externalId.slice(2)) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id ?? a.externalId).localeCompare(b.id ?? b.externalId));
}

export async function listHypotheses(sessionId: string, userId: string, status?: HypothesisStatus, page = 1) {
  const session = await ownedHypothesisSession(sessionId, userId);
  return prisma.$transaction(async tx => {
    const grouped = await tx.researchHypothesis.groupBy({ by: ['status'], where: { sessionId }, _count: { _all: true } });
    const counts = Object.fromEntries(HYPOTHESIS_STATUSES.map(value => [value, grouped.find(group => group.status === value)?._count._all ?? 0]));
    const total = status ? counts[status] : grouped.reduce((sum, group) => sum + group._count._all, 0);
    const bounds = paginationBounds({ page, pageSize: 25, q: '' }, total);
    const selectedStatus = status ?? null;
    const ids = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ResearchHypothesis"
      WHERE "sessionId" = ${sessionId} AND (${selectedStatus}::text IS NULL OR "status"::text = ${selectedStatus}::text)
      ORDER BY CASE "status"::text WHEN 'OPEN' THEN 0 WHEN 'TESTING' THEN 1 WHEN 'BLOCKED' THEN 2 WHEN 'REJECTED' THEN 3 ELSE 4 END,
        CASE WHEN "externalId" ~ '^H-[0-9]{3,6}$' THEN substring("externalId" from 3)::integer ELSE 2147483647 END, "createdAt", "id"
      LIMIT 25 OFFSET ${bounds.skip}`;
    const rows = sortHypotheses(await tx.researchHypothesis.findMany({
      where: { id: { in: ids.map(item => item.id) }, sessionId },
      include: { promotion: { select: { findingId: true, hypothesisRevision: true } } },
    }));
    return { session, counts, total, page: bounds.page, pages: bounds.pages, pageSize: 25, hypotheses: safeResearchRead(rows) };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function hypothesisDetail(sessionId: string, hypothesisId: string, userId: string, revisionPage = 1) {
  const session = await ownedHypothesisSession(sessionId, userId);
  return prisma.$transaction(async tx => {
    const bounds = paginationBounds({ page: revisionPage, pageSize: 25, q: '' },
      await tx.researchHypothesisRevision.count({ where: { hypothesisId, hypothesis: { sessionId } } }));
    const hypothesis = await tx.researchHypothesis.findFirst({
      where: { id: hypothesisId, sessionId },
      include: {
        promotion: { select: { findingId: true, hypothesisRevision: true } },
        revisions: { orderBy: { revision: 'desc' }, take: 25, skip: bounds.skip },
      },
    });
    if (!hypothesis) throw new HypothesisSyncError('NOT_FOUND', 'Research hypothesis not found', 404);
    const currentRevision = await tx.researchHypothesisRevision.findUnique({
      where: { hypothesisId_revision: { hypothesisId, revision: hypothesis.revision } },
      select: { humanReview: true },
    });
    return {
      session,
      humanReview: safeResearchRead(currentRevision?.humanReview ?? null),
      hypothesis: safeResearchRead(hypothesis),
      revisionPage: bounds.page,
      revisionPages: bounds.pages,
      revisionTotal: bounds.total,
      revisionPageSize: 25,
    };
  }, { isolationLevel: 'RepeatableRead' });
}
