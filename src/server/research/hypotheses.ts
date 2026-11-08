import {paginationBounds} from '@/lib/pagination';
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hypothesesDocumentSchema, safeHypothesisIssues, type ResearchHypothesisInput, researchDataSchema, hypothesisSchema, hypothesisV2Schema, hypothesisEvidence, researchBindingError, hypothesisTransitionError, HYPOTHESIS_STATUSES, type HypothesisStatus } from "@/lib/research/hypotheses";
import { exportText } from "./workspace";
import { ownedResearch, researchRootFor } from "./sessions";
import { HypothesisWorkspace, HypothesisSyncError } from "./hypothesisFiles";

export { HypothesisSyncError };
/** Redact again at read time so legacy snapshots benefit without rewriting history. */
function safeResearchRead<T>(value: T): T {
  if (typeof value === "string") return exportText(value) as T;
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(safeResearchRead) as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeResearchRead(item)])) as T;
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

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

export async function syncHypotheses(sessionId: string, userId: string) {
  return prisma.$transaction(async tx => {
    // One import per session at a time; revision increment and all snapshots are
    // committed atomically. No filesystem watcher or workspace writes.
    await tx.$queryRaw`SELECT "id" FROM "ResearchSession" WHERE "id" = ${sessionId} AND "userId" = ${userId} FOR UPDATE`;
    const session = await tx.researchSession.findFirst({ where: { id: sessionId, ...ownedResearch(userId) }, select: { id: true, workspaceId: true, status: true, targetId: true, targetHost: true, authorizationSnapshot: true, researchPlanId: true, target: { select: { scheme: true } } } });
    if (!session) throw new HypothesisSyncError("NOT_FOUND", "Research session not found", 404);
    if (session.status !== "READY") throw new HypothesisSyncError("SESSION_NOT_READY", "Only READY sessions can sync; archived sessions are read-only", 409);
    // Scope revocation does not prohibit importing historical notes. No target
    // request, scan, Finding, human review, Report or scope mutation occurs here.
    const workspace = await HypothesisWorkspace.open(researchRootFor(session.workspaceId), session.workspaceId);
    try {
      const raw = await workspace.readDocument();
      let input: unknown;
      try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
      catch { throw new HypothesisSyncError("INVALID_JSON", "research/hypotheses.json is invalid. Run bughunter-validate-hypotheses inside the research workspace."); }
      const parsed = hypothesesDocumentSchema.safeParse(input);
      if (!parsed.success) throw new HypothesisSyncError("INVALID_DOCUMENT", "Hypotheses validation failed. Run bughunter-validate-hypotheses inside the research workspace.", 400, safeHypothesisIssues(parsed.error));
      if (parsed.data.sessionId !== session.id) throw new HypothesisSyncError("SESSION_MISMATCH", "hypotheses.json sessionId does not match this Research Session");
      const linkedItemIds=[...new Set(parsed.data.hypotheses.flatMap(h=>h.planItemId?[h.planItemId]:[]))];
      if(linkedItemIds.length){
        const delivered=await tx.researchReconDelivery.findFirst({where:{sessionId:session.id,status:'STAGED'},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{snapshot:{select:{researchPlanId:true}}}});
        const planIds=[session.researchPlanId,delivered?.snapshot.researchPlanId].filter((id):id is string=>Boolean(id));
        const items=await tx.researchPlanItem.findMany({where:{id:{in:linkedItemIds},plan:{id:{in:planIds},targetId:session.targetId,program:{ownerId:userId}}},select:{id:true}});
        if(items.length!==linkedItemIds.length)throw new HypothesisSyncError('INVALID_PLAN_ITEM','A linked plan item must belong to this session’s initial or most recently delivered plan for the same Target.',400);
      }
      const checked = new Set<string>();
      for (const [index, h] of parsed.data.hypotheses.entries()) {
        if ("targetId" in h) {
          const binding = researchBindingError(h, { id: session.targetId, host: session.targetHost, scheme: (session.authorizationSnapshot as { scheme?: string } | null)?.scheme ?? session.target.scheme ?? "https" });
          if (binding) throw new HypothesisSyncError("SCOPE_MISMATCH", binding);
        }
        for (const [entry, evidence] of hypothesisEvidence(h).entries()) {
          if (checked.has(evidence.ref.split("#")[0])) continue;
          if (checked.size >= 1000) throw new HypothesisSyncError("REFERENCE_LIMIT", "At most 1000 distinct evidence artifacts per import");
          try { await workspace.checkReference(evidence.ref); }
          catch { throw new HypothesisSyncError("INVALID_REFERENCE", "An evidence artifact is missing or unsafe", 400, [{ path: `hypotheses.${index}.evidence.${entry}.ref`, message: "Artifact must exist inside this workspace without symlinks or hardlinks" }]); }
          checked.add(evidence.ref.split("#")[0]);
        }
      }
      let created = 0, updated = 0, unchanged = 0;
      const existing = await tx.researchHypothesis.findMany({ where: { sessionId }, select: { id: true, externalId: true, contentSha256: true, revision: true, status: true, researchData: true } });
      const byId = new Map(existing.map(h => [h.externalId, h]));
      const newCount = parsed.data.hypotheses.filter(h => !byId.has(h.externalId)).length;
      if (existing.length + newCount > 200) throw new HypothesisSyncError("REGISTRY_LIMIT", "A session can retain at most 200 hypotheses; omitted hypotheses are never deleted");
      const importedAt = new Date();
      for (const h of parsed.data.hypotheses) {
        let snapshot: ReturnType<typeof hypothesisSnapshot>;
        try { snapshot = hypothesisSnapshot(h); }
        catch { throw new HypothesisSyncError("SANITIZED_PROOF_INCOMPLETE", "Proof fields exceed their limits after redaction. Remove credentials from summaries."); }
        const contentSha256 = hash(JSON.stringify(snapshot)), previous = byId.get(h.externalId);
        const { researchData: _container, ...base } = snapshot;
        void _container;
        const candidate = { ...h, ...base, ...snapshot.researchData, notes: base.notes ?? undefined, blockedReason: base.blockedReason ?? undefined, confidence: base.confidence ?? undefined };
        const validSnapshot = ("targetId" in h ? hypothesisV2Schema : hypothesisSchema).safeParse(candidate);
        if (!validSnapshot.success) throw new HypothesisSyncError("SANITIZED_PROOF_INCOMPLETE", "Proof fields are incomplete after redaction. Keep secrets out of research summaries.");
        if ("targetId" in h) {
          const transition = previous ? hypothesisTransitionError(previous, h) : null;
          if (transition) throw new HypothesisSyncError("INVALID_TRANSITION", transition, 409);
        } else if (previous?.researchData) throw new HypothesisSyncError("CONTRACT_DOWNGRADE", "A v2 hypothesis cannot be replaced by a legacy v1 entry", 409);
        if (previous?.contentSha256 === contentSha256) { unchanged++; continue; }
        const revision = (previous?.revision ?? 0) + 1;
        const data = { ...snapshot, contentSha256, revision, sourceUpdatedAt: h.updatedAt ? new Date(h.updatedAt) : null, importedAt };
        const row = previous
          ? await tx.researchHypothesis.update({ where: { id: previous.id }, data })
          : await tx.researchHypothesis.create({ data: { sessionId, ...data } });
        await tx.researchHypothesisRevision.create({ data: { hypothesisId: row.id, revision, snapshot, source: "WORKSPACE_IMPORT" } });
        if (previous) updated++; else created++;
      }
      await tx.researchSession.update({ where: { id: sessionId }, data: { hypothesesSyncedAt: importedAt, hypothesesSourceSha256: hash(raw) } });
      return { created, updated, unchanged, conflicts: [], total: parsed.data.hypotheses.length };
    } finally { await workspace.close(); }
  }, { timeout: 20000 });
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
  const source = await tx.researchSession.findUnique({ where: { id: session.id }, select: { hypothesesSourceSha256: true } });
  const currentRevision = await tx.researchHypothesisRevision.findUnique({
    where: { hypothesisId_revision: { hypothesisId, revision: hypothesis.revision } },
    select: { humanReview: true },
  });
  return { session, hypothesesSourceSha256: source?.hypothesesSourceSha256 ?? null, humanReview: safeResearchRead(currentRevision?.humanReview ?? null), hypothesis: safeResearchRead(hypothesis), revisionPage:bounds.page,revisionPages:bounds.pages,revisionTotal:bounds.total, revisionPageSize:25 };
  },{isolationLevel:'RepeatableRead'});
}
