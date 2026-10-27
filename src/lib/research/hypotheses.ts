import { z } from "zod";

export const HYPOTHESIS_STATUSES = ["OPEN", "TESTING", "BLOCKED", "REJECTED", "CONFIRMED"] as const;
export const HYPOTHESES_MAX_BYTES = 1024 * 1024;
export const HYPOTHESES_MAX_COUNT = 200;
export const REGISTRY_NOTICE = "Technically confirmed research hypothesis. Not yet a reviewed BugHunter finding.";

/** Portable artifact names only. Encodings, URLs, hidden paths and dot segments
 * are rejected, rather than decoded or normalized into a different reference. */
export function isEvidenceRef(ref: string): boolean {
  if (ref.length > 500 || /[%\\\x00-\x20\x7f]/.test(ref)) return false;
  const [path, fragment, extra] = ref.split("#");
  if (extra !== undefined || fragment !== undefined && (!fragment || !/^[A-Za-z0-9_./~:-]+$/.test(fragment))) return false;
  const parts = path.split("/");
  return parts.length <= 12 && parts.every(part => /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(part));
}
const text = (max: number) => z.string().trim().min(1).max(max);
export const evidenceReferenceSchema = z.strictObject({
  ref: text(500).refine(isEvidenceRef, "Use a relative workspace artifact without traversal, URL or encoding"),
  summary: text(2000),
});
export type ResearchEvidenceReference = z.infer<typeof evidenceReferenceSchema>;
const legacyFields = z.strictObject({
  externalId: z.string().regex(/^H-[0-9]{3,6}$/),
  title: text(200),
  status: z.enum(["OPEN", "BLOCKED", "REJECTED", "CONFIRMED"]),
  hypothesis: text(4000),
  evidenceFor: z.array(evidenceReferenceSchema).max(50),
  evidenceAgainst: z.array(evidenceReferenceSchema).max(50),
  nextTest: text(4000),
  expectedSignal: text(2000),
  falsificationCondition: text(2000),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  tags: z.array(text(50).regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/i)).max(20).default([]),
  notes: text(4000).optional(),
  blockedReason: text(2000).optional(),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
});
export const hypothesisSchema = legacyFields.superRefine((hypothesis, ctx) => {
  if (["OPEN", "CONFIRMED"].includes(hypothesis.status) && !hypothesis.evidenceFor.length) ctx.addIssue({ code: "custom", path: ["evidenceFor"], message: "OPEN and CONFIRMED require supporting evidence" });
  if (hypothesis.status === "BLOCKED" && !hypothesis.blockedReason) ctx.addIssue({ code: "custom", path: ["blockedReason"], message: "BLOCKED requires a blockedReason" });
  if (hypothesis.status === "REJECTED" && !hypothesis.evidenceAgainst.length && !hypothesis.notes) ctx.addIssue({ code: "custom", path: ["evidenceAgainst"], message: "REJECTED requires evidenceAgainst or a notes justification" });
});
export const OBSERVATION_SOURCES = ["RECON", "BURP_MCP", "MANUAL", "HTTP", "BROWSER", "STATIC_ANALYSIS", "EXISTING_FINDING"] as const;
export const EVIDENCE_QUALITIES = ["OBSERVATION", "REPRODUCIBLE", "CONTROLLED", "IMPACT_DEMONSTRATED"] as const;
const hostField = text(253).regex(/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/);
const locationField = text(2048).nullable();
export const researchObservationSchema = z.strictObject({
  id: text(20).regex(/^O-[0-9]{3,6}$/),
  source: z.enum(OBSERVATION_SOURCES), host: hostField, location: locationField,
  observedAt: z.iso.datetime({ offset: true }), summary: text(2000),
  evidence: z.array(evidenceReferenceSchema).min(1).max(10),
});
const negativeControlSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("PERFORMED"), procedure: text(4000), observations: z.array(researchObservationSchema).min(1).max(10), significance: text(2000).min(20) }),
  z.strictObject({ kind: z.literal("NOT_APPLICABLE"), reason: text(2000).min(40) }),
  z.strictObject({ kind: z.literal("NOT_PERFORMED"), reason: text(2000) }),
]);
export const researchTestSchema = z.strictObject({
  id: text(20).regex(/^T-[0-9]{3,6}$/), rationale: text(2000), procedure: text(4000),
  expectedSignal: text(2000), falsificationCondition: text(2000),
  performedAt: z.iso.datetime({ offset: true }),
  observations: z.array(researchObservationSchema).min(1).max(10),
  negativeControl: negativeControlSchema,
  outcome: z.enum(["SUPPORTS", "REFUTES", "INCONCLUSIVE"]),
  reproduced: z.boolean(), reproductionSteps: z.array(text(1000)).min(1).max(10),
  reproducibility: text(2000), securityEffect: text(2000),
  evidenceQuality: z.enum(EVIDENCE_QUALITIES), conclusion: text(2000),
});
// These are claims of research evidence, never an automated truth/severity gate.
export const researchDataSchema = z.strictObject({
  targetId: text(100), host: hostField, location: locationField,
  suspectedVulnClass: text(80).regex(/^[A-Z][A-Z0-9_ -]*$/).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  initialObservations: z.array(researchObservationSchema).min(1).max(20),
  reasoning: text(4000), prerequisites: z.array(text(500)).max(20),
  suspectedImpact: text(2000), tests: z.array(researchTestSchema).max(30),
  nextTestRationale: text(2000), conclusion: text(4000).nullable(),
  suggestedSeverity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).nullable(),
});
export type ResearchData = z.infer<typeof researchDataSchema>;
export function researchObservations(data: ResearchData) {
  return [...data.initialObservations, ...data.tests.flatMap(t => [...t.observations, ...(t.negativeControl.kind === "PERFORMED" ? t.negativeControl.observations : [])])];
}
export function hasReproducibleProof(data: ResearchData) {
  const direct = (o: z.infer<typeof researchObservationSchema>) => ["MANUAL", "HTTP", "BROWSER"].includes(o.source) && o.evidence.some(e => (e.ref.startsWith("evidence/") || e.ref.startsWith("requests/")) && !e.ref.startsWith("evidence/burp/") && !e.ref.startsWith("requests/burp/") && !e.ref.endsWith("README.md"));
  return data.tests.some(t => t.outcome === "SUPPORTS" && t.reproduced &&
    t.reproductionSteps.length >= 2 && t.reproducibility.length >= 40 && t.securityEffect.length >= 40 &&
    t.evidenceQuality !== "OBSERVATION" && t.negativeControl.kind !== "NOT_PERFORMED" &&
    t.observations.some(direct) && (t.negativeControl.kind !== "PERFORMED" || t.negativeControl.observations.some(direct)));
}
const normalizeTest = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export const hypothesisV2Schema = legacyFields.extend({
  status: z.enum(HYPOTHESIS_STATUSES), confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  ...researchDataSchema.shape,
}).superRefine((h, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(h)).byteLength > 128 * 1024) ctx.addIssue({ code: "custom", path: ["tests"], message: "A hypothesis record cannot exceed 128 KiB" });
  const issue = (field: string, message: string) => ctx.addIssue({ code: "custom", path: [field], message });
  if (["OPEN", "TESTING", "CONFIRMED"].includes(h.status) && !h.evidenceFor.length) issue("evidenceFor", "Supporting evidence is required");
  if (h.status === "BLOCKED" && !h.blockedReason) issue("blockedReason", "BLOCKED requires a blockedReason");
  if (h.status === "REJECTED" && (!h.conclusion || !h.tests.some(t => t.outcome === "REFUTES") || !h.evidenceAgainst.length)) issue("conclusion", "REJECTED requires retained falsifying tests, evidenceAgainst and conclusion");
  if (h.status === "CONFIRMED" && (!hasReproducibleProof(h) || !h.conclusion || h.conclusion.length < 40)) issue("tests", "CONFIRMED requires reproducible positive evidence, controls (or reason not applicable), security effect and conclusion for human review");
  if (["OPEN", "TESTING", "BLOCKED"].includes(h.status) && h.tests.some(t => normalizeTest(t.procedure) === normalizeTest(h.nextTest))) issue("nextTest", "Next test must differ from performed tests");
  const ids = researchObservations(h).map(o => o.id), tests = h.tests.map(t => t.id);
  if (new Set(ids).size !== ids.length) issue("initialObservations", "Observation IDs must be unique");
  if (new Set(tests).size !== tests.length) issue("tests", "Test IDs must be unique");
});
export const legacyDocumentSchema = z.strictObject({ version: z.literal(1), sessionId: text(200).regex(/^[A-Za-z0-9_-]+$/), hypotheses: z.array(hypothesisSchema).max(HYPOTHESES_MAX_COUNT) });
export const detailedDocumentSchema = z.strictObject({ version: z.literal(2), sessionId: text(200).regex(/^[A-Za-z0-9_-]+$/), hypotheses: z.array(hypothesisV2Schema).max(HYPOTHESES_MAX_COUNT) });
export const hypothesesDocumentSchema = z.discriminatedUnion("version", [legacyDocumentSchema, detailedDocumentSchema]).superRefine((document, ctx) => {
  const ids = new Set<string>();
  document.hypotheses.forEach((h, index) => {
    if (ids.has(h.externalId)) ctx.addIssue({ code: "custom", path: ["hypotheses", index, "externalId"], message: "Duplicate externalId" });
    ids.add(h.externalId);
  });
});
export type WorkspaceHypothesis = z.infer<typeof hypothesisSchema>;
export type DetailedHypothesis = z.infer<typeof hypothesisV2Schema>;
export type ResearchHypothesisInput = WorkspaceHypothesis | DetailedHypothesis;
export type HypothesesDocument = z.infer<typeof hypothesesDocumentSchema>;
export type HypothesisStatus = typeof HYPOTHESIS_STATUSES[number];
export function hypothesisEvidence(h: ResearchHypothesisInput) {
  return [...h.evidenceFor, ...h.evidenceAgainst, ...("targetId" in h ? researchObservations(h).flatMap(o => o.evidence) : [])];
}
export function researchBindingError(h: DetailedHypothesis, target: { id: string; host: string; scheme: string }) {
  if (h.targetId !== target.id || h.host !== target.host) return "Hypothesis target/host differs from the workspace";
  const validLocation = (location: string | null) => {
    if (location === null) return true;
    try { const u = new URL(location); return u.hostname === target.host && u.protocol === `${target.scheme}:` && !u.port; } catch { return false; }
  };
  if (!validLocation(h.location) || researchObservations(h).some(o => o.host !== target.host || !validLocation(o.location))) return "Observation location/host differs from the workspace";
  return null;
}
export function hypothesisTransitionError(previous: { status: HypothesisStatus; researchData?: unknown }, next: DetailedHypothesis) {
  if (previous.status === "REJECTED" && next.status !== "REJECTED") {
    if (!["OPEN", "TESTING"].includes(next.status)) return "Reopen a rejected hypothesis before confirming it";
    const old = researchDataSchema.safeParse(previous.researchData);
    if (!old.success || !next.tests.some(t => !old.data.tests.some(p => p.id === t.id)) && !next.initialObservations.some(o => !old.data.initialObservations.some(p => p.id === o.id))) return "Reopening requires a new distinct test or observation";
  }
  return null;
}

/** No user-controlled values/unknown property names in diagnostics or logs. */
export function safeHypothesisIssues(error: z.ZodError) {
  const fields = new Set(["targetId", "host", "location", "suspectedVulnClass", "createdAt", "initialObservations", "reasoning", "prerequisites", "suspectedImpact", "tests", "nextTestRationale", "conclusion", "suggestedSeverity", "id", "source", "observedAt", "evidence", "rationale", "procedure", "performedAt", "observations", "negativeControl", "kind", "significance", "reason", "outcome", "reproduced", "reproductionSteps", "reproducibility", "securityEffect", "evidenceQuality","version", "sessionId", "hypotheses", "externalId", "title", "status", "hypothesis", "evidenceFor", "evidenceAgainst", "ref", "summary", "nextTest", "expectedSignal", "falsificationCondition", "confidence", "tags", "notes", "blockedReason", "updatedAt"]);
  return error.issues.slice(0, 50).map(issue => ({
    path: issue.path.map(part => typeof part === "number" ? part : fields.has(String(part)) ? String(part) : "field").join("."),
    message: issue.code === "custom" ? issue.message : issue.code === "unrecognized_keys" ? "Unknown fields are not allowed" : issue.code === "too_big" ? "Exceeds field limit" : issue.code === "invalid_type" ? "Required field or invalid type" : "Invalid value or format",
  }));
}

/** Structural schema for editors; cross-field status rules use the Zod validator. */
export function hypothesesJsonSchema() {
  return z.toJSONSchema(detailedDocumentSchema, { target: "draft-2020-12" });
}
