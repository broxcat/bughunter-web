import { z } from "zod";
export const REVIEW_STATES = ["CANDIDATE", "EVIDENCE_REVIEW", "CONFIRMED", "REJECTED", "INCONCLUSIVE"] as const;
export type ReviewState = typeof REVIEW_STATES[number];
export const evidenceReviewSchema = z.object({
  status: z.enum(REVIEW_STATES).exclude(["CANDIDATE"]),
  notes: z.string().trim().max(20000).default(""),
});
/** Historical decisions retain their meaning; old answer blobs are never used. */
export function findingReviewStatus(f: { reviewStatus?: string; reviewEvidence?: unknown; gateStatus?: string }): ReviewState {
  if (f.reviewStatus && f.reviewStatus !== "CANDIDATE" && REVIEW_STATES.includes(f.reviewStatus as ReviewState)) return f.reviewStatus as ReviewState;
  if (!f.reviewEvidence && f.gateStatus === "PASSED") return "CONFIRMED";
  if (!f.reviewEvidence && f.gateStatus === "KILLED") return "REJECTED";
  return "CANDIDATE";
}
export function reviewDecision(finding: { reviewStatus?: string; reviewEvidence?: unknown; gateStatus?: string; evidence?: string | null }, next: ReviewState, notes: string, inScope: boolean): string | null {
  const current = findingReviewStatus(finding);
  if (next === "EVIDENCE_REVIEW") return null;
  if (current !== "EVIDENCE_REVIEW") return "Start an evidence review before deciding";
  if (notes.trim().length < 20) return "Describe the reproduction, impact or reason for this decision";
  if (next === "CONFIRMED" && (!inScope || !finding.evidence?.trim())) return "Confirmation requires in-scope evidence and a reproducible observation";
  return null;
}
