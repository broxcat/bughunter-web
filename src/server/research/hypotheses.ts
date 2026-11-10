import {paginationBounds} from '@/lib/pagination';
import { prisma } from "@/lib/prisma";
import { type ResearchHypothesisInput, researchDataSchema, HYPOTHESIS_STATUSES, type HypothesisStatus } from "@/lib/research/hypotheses";
import { exportText } from "./workspace";
import { ownedResearch } from "./sessions";
import { HypothesisSyncError } from "./hypothesisFiles";

export { HypothesisSyncError };
/** Redact again at read time so legacy snapshots benefit without rewriting history. */
function safeResearchRead<T>(value: T): T {
  if (typeof value === "string") return exportText(value) as T;
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(safeResearchRead) as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeResearchRead(item)])) as T;
}

/** Explicit normalized/sanitized snapshot, also used as the revision payload.
 * Source timestamps are provenance, not content edits. No raw evidence content. */
export function hypothesisSnapshot(h: ResearchHypothesisInput) {
  const sanitize = (value: unknown): unknown => typeof value === "string" ? exportText(value) : Array.isArray(value) ? value.map(sanitize) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)])) : value;
  const researchData = "targetId" in h ? researchDataSchema.parse(sanitize(Object.fromEntries(Object.keys(researchDataSchema.shape).map(key => [key, h[key as keyof typeof h]])))) : undefined;
  return {
    planItemId: h.planItemId ?? null,
    ...(researchData ? { researchData } : {}),
    externalId: h.externalId, title: exportText(h.title), status: h.status,
    hypothesis: exportText(h.hypothesis),
    evidenceFor: h.evidenceFor.map(e => ({ ref: e.ref, summary: exportText(e.summary) })),
    evidenceAgainst: h.evidenceAgainst.map(e => ({ ref: e.ref, summary: exportText(e.summary) })),
    nextTest: exportText(h.nextTest), expectedSignal: exportText(h.expectedSignal),
    falsificationCondition: exportText(h.falsificationCondition),
    confidence: h.confidence ?? null, tags: [...new Set(h.tags.map(exportText))].sort(),
    notes: h.notes ? exportText(h.notes) : null,
    blockedReason: h.blockedReason ? exportText(h.blockedReason) : null,
  };
}

export async function ownedHypothesisSession(sessionId: string, userId: string) {
  const session = await prisma.researchSession.findFirst({ where: { id: sessionId, ...ownedResearch(userId) }, select: { id: true, workspaceId: true, targetId: true, consoleTargetId: true, status: true, hypothesesSyncedAt: true, authorizationSnapshot: true } });
  if (!session) throw new HypothesisSyncError("NOT_FOUND", "Research session not found", 404);
  return session;
}
export function sortHypotheses<T extends { status: HypothesisStatus; externalId: string; createdAt: Date; id?:string }>(rows: T[]) {
  return rows.sort((a, b) => HYPOTHESIS_STATUSES.indexOf(a.status) - HYPOTHESIS_STATUSES.indexOf(b.status) || Number(a.externalId.slice(2)) - Number(b.externalId.slice(2)) || a.createdAt.getTime() - b.createdAt.getTime() || (a.id??a.externalId).localeCompare(b.id??b.externalId));
}
export async function listHypotheses(sessionId: string, userId: string, status?: HypothesisStatus, page = 1) {
  const session = await ownedHypothesisSession(sessionId, userId);
  return prisma.$transaction(async tx=>{
  const grouped = await tx.researchHypothesis.groupBy({ by: ["status"], where: { sessionId }, _count: { _all: true } });
  const counts = Object.fromEntries(HYPOTHESIS_STATUSES.map(s => [s, grouped.find(g => g.status === s)?._count._all ?? 0]));
  const total=status?counts[status]:grouped.reduce((sum,g)=>sum+g._count._all,0),bounds=paginationBounds({page,pageSize:25,q:''},total);
  const selectedStatus = status ?? null;
  // Fetch only the current page's payloads, never every structured proof blob.
  // CASE order is explicit: PostgreSQL adds TESTING at the enum's end.
  const ids = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ResearchHypothesis"
    WHERE "sessionId" = ${sessionId} AND (${selectedStatus}::text IS NULL OR "status"::text = ${selectedStatus}::text)
    ORDER BY CASE "status"::text WHEN 'OPEN' THEN 0 WHEN 'TESTING' THEN 1 WHEN 'BLOCKED' THEN 2 WHEN 'REJECTED' THEN 3 ELSE 4 END,
      CASE WHEN "externalId" ~ '^H-[0-9]{3,6}$' THEN substring("externalId" from 3)::integer ELSE 2147483647 END, "createdAt", "id"
    LIMIT 25 OFFSET ${bounds.skip}`;
  const rows = sortHypotheses(await tx.researchHypothesis.findMany({ where: { id: { in: ids.map(i => i.id) }, sessionId }, include: { promotion: { select: { findingId: true, hypothesisRevision: true } } } }));
  return { session, counts, total, page:bounds.page,pages:bounds.pages, pageSize:25, hypotheses: safeResearchRead(rows) };
  },{isolationLevel:'RepeatableRead'});
}
export async function hypothesisDetail(sessionId: string, hypothesisId: string, userId: string, revisionPage = 1) {
  const session = await ownedHypothesisSession(sessionId, userId);
  return prisma.$transaction(async tx=>{
  const bounds=paginationBounds({page:revisionPage,pageSize:25,q:''},await tx.researchHypothesisRevision.count({where:{hypothesisId,hypothesis:{sessionId}}}));
  const hypothesis = await tx.researchHypothesis.findFirst({ where: { id: hypothesisId, sessionId }, include: { promotion: { select: { findingId: true, hypothesisRevision: true } }, revisions: { orderBy: { revision: "desc" }, take: 25, skip:bounds.skip } } });
  if (!hypothesis) throw new HypothesisSyncError("NOT_FOUND", "Research hypothesis not found", 404);
  const currentRevision = await tx.researchHypothesisRevision.findUnique({
    where: { hypothesisId_revision: { hypothesisId, revision: hypothesis.revision } },
    select: { humanReview: true },
  });
  return { session, humanReview: safeResearchRead(currentRevision?.humanReview ?? null), hypothesis: safeResearchRead(hypothesis), revisionPage:bounds.page,revisionPages:bounds.pages,revisionTotal:bounds.total, revisionPageSize:25 };
  },{isolationLevel:'RepeatableRead'});
}
