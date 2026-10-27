// Historical finding evidence display. No scanner execution or payload catalogue.
export type EvidenceLevel = "SIGNAL" | "CANDIDATE" | "VALIDATED" | "CONFIRMED" | "FALSE_POSITIVE" | "INCONCLUSIVE";
export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = { SIGNAL: "Signal", CANDIDATE: "Candidate", VALIDATED: "Validated", CONFIRMED: "Confirmed", FALSE_POSITIVE: "False positive", INCONCLUSIVE: "Inconclusive" };
/** Legacy PROVEN alone did not guarantee independent confirmation. */
export function findingEvidenceLevel(f: { huntMetadata?: unknown; severity?: string; gateStatus?: string }): EvidenceLevel {
  const metadata = f.huntMetadata as { evidenceLevel?: string } | null;
  if (metadata?.evidenceLevel && metadata.evidenceLevel in EVIDENCE_LABELS) return metadata.evidenceLevel as EvidenceLevel;
  return f.gateStatus === "PASSED" ? "VALIDATED" : f.severity === "INFO" ? "SIGNAL" : "CANDIDATE";
}
