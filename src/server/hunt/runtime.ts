import { loadTargetExecution } from "@/server/execution";
import { revalidateTargetSessions } from "@/server/credentials/connection";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { HUNT_CAPABILITIES, type HuntFamily, type HuntPolicySnapshot } from "@/lib/hunt/policy";
import { selectHuntTechniques } from "@/lib/hunt/catalog";
import { safeObservationUrl, redactHuntText } from "@/lib/hunt/safety";
import type { HuntReport, HuntCandidate } from "@/lib/hunt/report";
import type { ScanContext } from "@/server/scanners/context";
import { logLine } from "@/server/scanners/context";
import { clearDiscoveryCorpus } from "@/server/scanners/discovery";
import { probe, type ProbeOptions, type ProbeResult } from "@/server/scanners/http";
import { loadTargetCredentials, type DecryptedTargetCredential } from "@/server/credentials";
import { loadHuntReadiness } from "./readiness";
import { collectHuntCorpus, persistableCorpus, type HuntCorpus } from "./corpus";
import { HUNT_LIMITS, HuntBudget, HuntLimitError } from "./budget";
import { executeHuntTechnique } from "./techniques";
import type { HuntReadiness } from "@/lib/hunt/readiness";

export interface TechniqueContext {
  ctx: ScanContext; corpus: HuntCorpus; credentials: DecryptedTargetCredential[];
  cache: Map<string, unknown>;
  approvedTechniques: readonly string[];
  request(url: string, opts?: ProbeOptions): Promise<ProbeResult>;
  remainingMs(): number;
}
interface Session extends TechniqueContext {
  budget: HuntBudget; report: HuntReport; readiness: HuntReadiness;
  plan: ReturnType<typeof selectHuntTechniques>;
  persist(): Promise<void>;
}
const storage = new AsyncLocalStorage<Session>();
const limitCodes = new Set(["HUNT_TIMEOUT", "TOTAL_REQUEST_LIMIT", "FAMILY_REQUEST_LIMIT", "TECHNIQUE_REQUEST_LIMIT", "PARAMETER_PROBE_LIMIT", "DISCOVERY_REQUEST_LIMIT", "CONCURRENCY_LIMIT", "STATE_CHANGING_REQUEST_UNSUPPORTED", "SCOPE_REVOKED"]);
export async function withHuntSession(ctx: ScanContext, snapshot: HuntPolicySnapshot, work: (readiness: { families: HuntReadiness }) => Promise<void>) {
  const budget = new HuntBudget(async () => {
    const execution = await loadTargetExecution(ctx.targetId);
    if (execution.host !== ctx.host) throw new Error("SCOPE_IDENTITY_CHANGED");
  });
  const report: HuntReport = { version: 1, startedAt: new Date().toISOString(), status: "RUNNING", requests: 0, limits: { ...HUNT_LIMITS }, families: [], techniques: [], candidates: [] };
  const persist = async () => {
    report.requests = budget.requests;
    await prisma.scanRun.updateMany({ where: { id: ctx.scanRunId, targetId: ctx.targetId, type: "HUNT" }, data: { huntReport: JSON.parse(JSON.stringify(report)) } });
  };
  try {
    await persist();
    await budget.run(async () => {
      await revalidateTargetSessions(ctx.targetId);
      const corpus = await collectHuntCorpus(ctx);
      const credentials = await loadTargetCredentials(ctx.targetId);
      const readiness = await loadHuntReadiness(ctx.targetId, snapshot, { publicXssSurface: corpus.publicXssSurface, discoveryComplete: Boolean(corpus.raw.pages?.length), objectReference: corpus.surface.objectReferences, jwt: corpus.jwtPresent, xmlEndpoint: corpus.surface.xml, oauthFlow: corpus.surface.oauth, stateChangingEndpoint: corpus.forms.some(f => f.method !== "GET") });
      const surface = { ...corpus.surface, apiEndpoints: corpus.surface.apiEndpoints || credentials.some(c => Boolean(c.ownedObjectUrl)), jwt: readiness.facts.jwt, cookies: corpus.surface.cookies || readiness.facts.sessionCookie, objectReferences: corpus.surface.objectReferences || readiness.facts.secondUserObjectReference };
      const plan = selectHuntTechniques(readiness.families, surface, readiness.facts, undefined, snapshot.approvedTechniques);
      report.families = readiness.families.map(f => ({ family: f.family, displayName: f.displayName, selected: f.selected, selectionReason: f.reason, reason: f.prerequisites.filter(p => !p.satisfied).map(p => p.reason).join(" ") || f.reason, readiness: f.state, state: !f.selected || f.state === "NOT_APPLICABLE" ? "SKIPPED" : f.safeSubset ? "WAITING" : "BLOCKED", completedTechniques: 0, applicableTechniques: plan.filter(p => p.technique.family === f.family && p.executable).length, requests: 0 }));
      report.techniques = plan.map(p => ({ techniqueId: p.technique.id, family: p.technique.family, title: p.technique.title, state: p.executable ? "WAITING" : "SKIPPED", requests: 0, reason: p.reason, referenceIds: p.technique.references.map(r => r.id) }));
      await prisma.scanRun.updateMany({ where: { id: ctx.scanRunId, targetId: ctx.targetId }, data: { reconCorpus: persistableCorpus(corpus) } });
      for (const family of report.families.filter(f => f.selected && f.state === "BLOCKED")) await logLine(ctx.scanRunId, `[hunt] ${family.displayName}: ${family.readiness} — ${family.reason}`);
      const session: Session = { ctx, corpus, credentials, approvedTechniques: snapshot.approvedTechniques, cache: new Map(), budget, report, readiness: readiness.families, plan, persist, remainingMs: budget.remainingMs, request: async (url, opts = {}) => {
        const r = await probe(url, { ...opts, timeoutMs: HUNT_LIMITS.requestTimeoutMs, maxBodyBytes: HUNT_LIMITS.maxBodyBytes });
        if (r.error && limitCodes.has(r.error)) throw new HuntLimitError(r.error);
        if (r.error) session.cache.set(`transport-failure:${budget.technique?.id}`, true);
        return r;
      } };
      await persist();
      await storage.run(session, () => work({ families: readiness.families }));
    });
    report.status = budget.requests >= HUNT_LIMITS.maxTotalRequests || !budget.remainingMs() ? "LIMIT_REACHED" : "COMPLETED";
  } catch (e) {
    report.status = e instanceof HuntLimitError ? "LIMIT_REACHED" : "FAILED";
    if (!(e instanceof HuntLimitError) || e.code === "SCOPE_REVOKED") { report.status = "FAILED"; throw e; }
  } finally {
    for (const f of report.families.filter(f => f.state === "WAITING")) { f.state = "SKIPPED"; f.reason = "HUNT_FINISHED_OR_LIMIT_REACHED"; }
    for (const t of report.techniques.filter(t => t.state === "WAITING")) { t.state = "SKIPPED"; t.reason = "HUNT_FINISHED_OR_LIMIT_REACHED"; }
    report.finishedAt = new Date().toISOString();
    budget.close(); clearDiscoveryCorpus(ctx.scanRunId);
    await persist();
  }
}
export async function runFamilyTechniques(ctx: ScanContext, family: HuntFamily): Promise<void> {
  const session = storage.getStore();
  if (!session || session.ctx.scanRunId !== ctx.scanRunId || session.ctx.targetId !== ctx.targetId) throw new Error("Family requires a prepared, authorized Hunt session");
  const f = session.report.families.find(v => v.family === family);
  if (!f?.selected || !session.readiness.find(v => v.family === family)?.safeSubset) return;
  const decisions = session.plan.filter(p => p.technique.family === family && p.executable).slice(0, HUNT_LIMITS.maxTechniquesPerFamily);
  session.budget.beginFamily(family);
  f.state = decisions.length ? "RUNNING" : "SKIPPED";
  if (!decisions.length) f.reason = "NO_APPLICABLE_SAFE_TECHNIQUES";
  await session.persist();
  for (const decision of decisions) {
    const technique = decision.technique;
    const progress = session.report.techniques.find(v => v.techniqueId === technique.id)!;
    if (session.report.candidates.filter(c => c.family === family && c.evidenceLevel === "CONFIRMED").length >= HUNT_LIMITS.maxConfirmationsPerFamily) { progress.state = "SKIPPED"; progress.reason = "FAMILY_ALREADY_CONFIRMED"; continue; }
    session.budget.beginTechnique(technique.id, technique.maxRequests);
    progress.state = "RUNNING"; await session.persist();
    try {
      await logLine(ctx.scanRunId, `[hunt] ${f.displayName} / ${technique.title}: RUNNING`);
      const observations = await executeHuntTechnique(technique, session);
      if (!observations.length && session.cache.has(`transport-failure:${technique.id}`)) observations.push({ title: "Technique transport incomplete", summary: "A required HTTP control failed; no vulnerability conclusion can be drawn.", evidenceLevel: "INCONCLUSIVE", controls: [] });
      if (observations.length) { f.state = "VALIDATING"; progress.state = "VALIDATING"; await session.persist(); }
      for (const raw of observations.slice(0, 5)) {
        if (session.report.candidates.length >= HUNT_LIMITS.maxCandidates) break;
        const evidenceLevel = raw.evidenceLevel === "CONFIRMED" && new Set(raw.controls).size < 2 ? "VALIDATED" : raw.evidenceLevel;
        const candidate: HuntCandidate = { ...raw, title: redactHuntText(raw.title), summary: redactHuntText(raw.summary), location: raw.location ? safeObservationUrl(raw.location) : undefined, evidenceLevel, id: randomUUID(), techniqueId: technique.id, family, prerequisitesUsed: technique.prerequisites, referenceIds: technique.references.map(r => r.id) };
        if (evidenceLevel === "CONFIRMED") {
          const finding = await prisma.finding.create({ data: { targetId: ctx.targetId, scanRunId: ctx.scanRunId, title: candidate.title, vulnClass: HUNT_CAPABILITIES.find(c => c.family === family)?.policyNames[0] ?? family, severity: candidate.severity ?? "LOW", confidence: "PROVEN", gateStatus: "UNVALIDATED", description: candidate.summary, location: candidate.location, evidence: JSON.stringify({ controls: candidate.controls, ...candidate.evidence }), huntMetadata: { techniqueId: technique.id, family, prerequisitesUsed: technique.prerequisites, evidenceLevel, referenceIds: candidate.referenceIds, catalogVersion: technique.version } } });
          candidate.findingId = finding.id;
        } else candidate.severity = undefined;
        session.report.candidates.push(candidate);
      }
      progress.state = "COMPLETED"; f.completedTechniques++;
    } catch (e) {
      if (e instanceof HuntLimitError && e.code === "SCOPE_REVOKED") throw e;
      progress.state = e instanceof HuntLimitError ? "LIMIT_REACHED" : "ERROR";
      progress.reason = e instanceof HuntLimitError ? e.code : "TECHNIQUE_FAILED_WITHOUT_CONFIRMATION";
      await logLine(ctx.scanRunId, `[hunt] ${technique.id}: ${progress.reason}`);
    } finally {
      progress.requests = session.budget.technique?.requests ?? 0;
      f.requests = session.budget.family?.requests ?? 0;
      await session.persist();
    }
    if (session.budget.controller.signal.aborted || !session.remainingMs() || session.budget.requests >= HUNT_LIMITS.maxTotalRequests) { f.state = "LIMIT_REACHED"; break; }
  }
  if (!["SKIPPED", "LIMIT_REACHED"].includes(f.state)) f.state = "COMPLETED";
  session.budget.technique = null; session.budget.family = null;
  await session.persist();
}
