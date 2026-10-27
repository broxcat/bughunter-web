import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hypothesesDocumentSchema, safeHypothesisIssues, type WorkspaceHypothesis, HYPOTHESIS_STATUSES, type HypothesisStatus } from "@/lib/research/hypotheses";
import { exportText } from "./workspace";
import { ownedResearch, researchRoot } from "./sessions";
import { HypothesisWorkspace, HypothesisSyncError } from "./hypothesisFiles";

export { HypothesisSyncError };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Explicit normalized/sanitized snapshot, also used as the revision payload.
 * Source timestamps are provenance, not content edits. No raw evidence content. */
export function hypothesisSnapshot(h: WorkspaceHypothesis) {
  return {
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
    const session = await tx.researchSession.findFirst({ where: { id: sessionId, ...ownedResearch(userId) }, select: { id: true, workspaceId: true, status: true } });
    if (!session) throw new HypothesisSyncError("NOT_FOUND", "Research session not found", 404);
    if (session.status !== "READY") throw new HypothesisSyncError("SESSION_NOT_READY", "Only READY sessions can sync; archived sessions are read-only", 409);
    // Scope revocation does not prohibit importing historical notes. No target
    // request, scan, Finding, human review, Report or scope mutation occurs here.
    const workspace = await HypothesisWorkspace.open(researchRoot(), session.workspaceId);
    try {
      const raw = await workspace.readDocument();
      let input: unknown;
      try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
      catch { throw new HypothesisSyncError("INVALID_JSON", "research/hypotheses.json is invalid. Run bughunter-validate-hypotheses inside the research workspace."); }
      const parsed = hypothesesDocumentSchema.safeParse(input);
      if (!parsed.success) throw new HypothesisSyncError("INVALID_DOCUMENT", "Hypotheses validation failed. Run bughunter-validate-hypotheses inside the research workspace.", 400, safeHypothesisIssues(parsed.error));
      if (parsed.data.sessionId !== session.id) throw new HypothesisSyncError("SESSION_MISMATCH", "hypotheses.json sessionId does not match this Research Session");
      const checked = new Set<string>();
      for (const [index, h] of parsed.data.hypotheses.entries()) {
        for (const kind of ["evidenceFor", "evidenceAgainst"] as const) {
          for (const [entry, evidence] of h[kind].entries()) {
            if (checked.has(evidence.ref.split("#")[0])) continue;
            try { await workspace.checkReference(evidence.ref); }
            catch { throw new HypothesisSyncError("INVALID_REFERENCE", "An evidence artifact is missing or unsafe", 400, [{ path: `hypotheses.${index}.${kind}.${entry}.ref`, message: "Artifact must exist inside this workspace without symlinks or hardlinks" }]); }
            checked.add(evidence.ref.split("#")[0]);
          }
        }
      }
      let created = 0, updated = 0, unchanged = 0;
      const existing = await tx.researchHypothesis.findMany({ where: { sessionId }, select: { id: true, externalId: true, contentSha256: true, revision: true } });
      const byId = new Map(existing.map(h => [h.externalId, h]));
      const newCount = parsed.data.hypotheses.filter(h => !byId.has(h.externalId)).length;
      if (existing.length + newCount > 200) throw new HypothesisSyncError("REGISTRY_LIMIT", "A session can retain at most 200 hypotheses; omitted hypotheses are never deleted");
      const importedAt = new Date();
      for (const h of parsed.data.hypotheses) {
        const snapshot = hypothesisSnapshot(h), contentSha256 = hash(JSON.stringify(snapshot)), previous = byId.get(h.externalId);
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
  const session = await prisma.researchSession.findFirst({ where: { id: sessionId, ...ownedResearch(userId) }, select: { id: true, workspaceId: true, targetId: true, status: true, hypothesesSyncedAt: true } });
  if (!session) throw new HypothesisSyncError("NOT_FOUND", "Research session not found", 404);
  return session;
}
export function sortHypotheses<T extends { status: HypothesisStatus; externalId: string; createdAt: Date }>(rows: T[]) {
  return rows.sort((a, b) => HYPOTHESIS_STATUSES.indexOf(a.status) - HYPOTHESIS_STATUSES.indexOf(b.status) || Number(a.externalId.slice(2)) - Number(b.externalId.slice(2)) || a.createdAt.getTime() - b.createdAt.getTime());
}
export async function listHypotheses(sessionId: string, userId: string, status?: HypothesisStatus, page = 1) {
  const session = await ownedHypothesisSession(sessionId, userId);
  const rows = sortHypotheses(await prisma.researchHypothesis.findMany({ where: { sessionId }, take: 200 }));
  const counts = Object.fromEntries(HYPOTHESIS_STATUSES.map(s => [s, rows.filter(h => h.status === s).length]));
  const filtered = status ? rows.filter(h => h.status === status) : rows;
  return { session, counts, total: filtered.length, page, pageSize: 25, hypotheses: filtered.slice((page - 1) * 25, page * 25) };
}
export async function hypothesisDetail(sessionId: string, hypothesisId: string, userId: string, revisionPage = 1) {
  const session = await ownedHypothesisSession(sessionId, userId);
  const hypothesis = await prisma.researchHypothesis.findFirst({ where: { id: hypothesisId, sessionId }, include: { revisions: { orderBy: { revision: "desc" }, take: 25, skip: (revisionPage - 1) * 25 } } });
  if (!hypothesis) throw new HypothesisSyncError("NOT_FOUND", "Research hypothesis not found", 404);
  return { session, hypothesis, revisionPage, revisionPageSize: 25 };
}
