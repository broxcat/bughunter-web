import type { EvidenceLevel, HuntReport } from "./report";
export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = { SIGNAL: "Signal", CANDIDATE: "Candidate", VALIDATED: "Validated", CONFIRMED: "Confirmed", FALSE_POSITIVE: "False positive", INCONCLUSIVE: "Inconclusive" };
/** Legacy PROVEN alone did not guarantee independent confirmation. */
export function findingEvidenceLevel(f: { huntMetadata?: unknown; severity?: string; gateStatus?: string }): EvidenceLevel {
  const metadata = f.huntMetadata as { evidenceLevel?: string } | null;
  if (metadata?.evidenceLevel && metadata.evidenceLevel in EVIDENCE_LABELS) return metadata.evidenceLevel as EvidenceLevel;
  return f.gateStatus === "PASSED" ? "VALIDATED" : f.severity === "INFO" ? "SIGNAL" : "CANDIDATE";
}
export function huntCounts(report: HuntReport) {
  const selected = report.families.filter(f => f.selected);
  return { Selected: selected.length, Ready: selected.filter(f => f.readiness === "READY").length, Degraded: selected.filter(f => f.readiness === "DEGRADED").length, Blocked: selected.filter(f => f.readiness === "BLOCKED").length };
}
