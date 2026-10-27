import { z } from "zod";

export const HYPOTHESIS_STATUSES = ["OPEN", "BLOCKED", "REJECTED", "CONFIRMED"] as const;
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
export const hypothesisSchema = z.strictObject({
  externalId: z.string().regex(/^H-[0-9]{3,6}$/),
  title: text(200),
  status: z.enum(HYPOTHESIS_STATUSES),
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
}).superRefine((hypothesis, ctx) => {
  if (["OPEN", "CONFIRMED"].includes(hypothesis.status) && !hypothesis.evidenceFor.length) ctx.addIssue({ code: "custom", path: ["evidenceFor"], message: "OPEN and CONFIRMED require supporting evidence" });
  if (hypothesis.status === "BLOCKED" && !hypothesis.blockedReason) ctx.addIssue({ code: "custom", path: ["blockedReason"], message: "BLOCKED requires a blockedReason" });
  if (hypothesis.status === "REJECTED" && !hypothesis.evidenceAgainst.length && !hypothesis.notes) ctx.addIssue({ code: "custom", path: ["evidenceAgainst"], message: "REJECTED requires evidenceAgainst or a notes justification" });
});
export const hypothesesDocumentSchema = z.strictObject({
  version: z.literal(1),
  sessionId: text(200).regex(/^[A-Za-z0-9_-]+$/),
  hypotheses: z.array(hypothesisSchema).max(HYPOTHESES_MAX_COUNT),
}).superRefine((document, ctx) => {
  const ids = new Set<string>();
  document.hypotheses.forEach((hypothesis, index) => {
    if (ids.has(hypothesis.externalId)) ctx.addIssue({ code: "custom", path: ["hypotheses", index, "externalId"], message: "Duplicate externalId" });
    ids.add(hypothesis.externalId);
  });
});
export type WorkspaceHypothesis = z.infer<typeof hypothesisSchema>;
export type HypothesesDocument = z.infer<typeof hypothesesDocumentSchema>;
export type HypothesisStatus = typeof HYPOTHESIS_STATUSES[number];

/** No user-controlled values/unknown property names in diagnostics or logs. */
export function safeHypothesisIssues(error: z.ZodError) {
  const fields = new Set(["version", "sessionId", "hypotheses", "externalId", "title", "status", "hypothesis", "evidenceFor", "evidenceAgainst", "ref", "summary", "nextTest", "expectedSignal", "falsificationCondition", "confidence", "tags", "notes", "blockedReason", "updatedAt"]);
  return error.issues.slice(0, 50).map(issue => ({
    path: issue.path.map(part => typeof part === "number" ? part : fields.has(String(part)) ? String(part) : "field").join("."),
    message: issue.code === "custom" ? issue.message : issue.code === "unrecognized_keys" ? "Unknown fields are not allowed" : issue.code === "too_big" ? "Exceeds field limit" : issue.code === "invalid_type" ? "Required field or invalid type" : "Invalid value or format",
  }));
}

/** Structural schema for editors; cross-field status rules use the Zod validator. */
export function hypothesesJsonSchema() {
  return z.toJSONSchema(hypothesesDocumentSchema, { target: "draft-2020-12" });
}
