import type { HuntFamilySelection } from "./policy";
import type { ReadinessState } from "./readiness";
export type EvidenceLevel = "SIGNAL" | "CANDIDATE" | "VALIDATED" | "CONFIRMED" | "FALSE_POSITIVE" | "INCONCLUSIVE";
export type TechniqueState = "WAITING" | "RUNNING" | "VALIDATING" | "COMPLETED" | "BLOCKED" | "SKIPPED" | "LIMIT_REACHED" | "ERROR";
export interface HuntObservation {
  title: string; summary: string; location?: string;
  evidenceLevel: EvidenceLevel; controls: string[];
  severity?: "LOW" | "MEDIUM" | "HIGH";
  evidence?: Record<string, string | number | boolean | null>;
}
export interface HuntCandidate extends HuntObservation {
  id: string; techniqueId: string; family: string; prerequisitesUsed: string[];
  referenceIds: string[]; findingId?: string;
}
export interface HuntReport {
  // Optional for compatibility with historical reports.
  execution?: { successfulRequests: number; failedRequests: number; issues: string[] };
  version: 1; startedAt: string; finishedAt?: string;
  status: "RUNNING" | "COMPLETED" | "LIMIT_REACHED" | "FAILED";
  requests: number;
  limits: Record<string, number>;
  families: (Omit<HuntFamilySelection, "reason"> & { selectionReason: HuntFamilySelection["reason"]; readiness: ReadinessState; state: TechniqueState; completedTechniques: number; applicableTechniques: number; requests: number; reason: string })[];
  techniques: { techniqueId: string; family: string; title: string; state: TechniqueState; requests: number; reason: string; referenceIds: string[] }[];
  candidates: HuntCandidate[];
}
