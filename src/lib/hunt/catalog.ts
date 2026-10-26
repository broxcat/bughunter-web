import { prerequisiteSatisfied } from "./readiness";
import type { HuntFamily } from "./policy";
import type { HuntRisk, PrerequisiteType, ReadinessFacts, HuntReadiness } from "./readiness";
import type { HuntReference } from "./references";
import { HUNT_TECHNIQUES } from "./catalogData";
export interface HuntTechniqueDescriptor {
  id: string; version: number; family: HuntFamily; title: string;
  prerequisites: PrerequisiteType[];
  applicability: "ALWAYS" | "QUERY_INPUT" | "OBJECT_REFERENCE" | "FORM" | "JAVASCRIPT" | "COOKIE" | "JWT" | "OAUTH" | "XML" | "URL_INPUT" | "FILE_INPUT" | "BUSINESS_FLOW" | "API_ENDPOINT";
  risk: HuntRisk; requiresApproval: boolean; implementation: "IMPLEMENTED" | "PLANNED" | "UNSUPPORTED";
  maxRequests: number; candidateEvidence: string; confirmationEvidence: string;
  negativeControls: string[]; evidenceRequired: string[]; references: HuntReference[];
}
export interface HuntSurface {
  queryInputs: boolean; objectReferences: boolean; forms: boolean; javascript: boolean; cookies: boolean;
  jwt: boolean; oauth: boolean; xml: boolean; urlInputs: boolean; fileInputs: boolean; businessFlows: boolean; apiEndpoints: boolean;
}
export const EMPTY_HUNT_SURFACE: HuntSurface = { queryInputs: false, objectReferences: false, forms: false, javascript: false, cookies: false, jwt: false, oauth: false, xml: false, urlInputs: false, fileInputs: false, businessFlows: false, apiEndpoints: false };
export function isTechniqueApplicable(technique: HuntTechniqueDescriptor, surface: HuntSurface): boolean {
  const keys: Record<Exclude<HuntTechniqueDescriptor["applicability"], "ALWAYS">, keyof HuntSurface> = { QUERY_INPUT: "queryInputs", OBJECT_REFERENCE: "objectReferences", FORM: "forms", JAVASCRIPT: "javascript", COOKIE: "cookies", JWT: "jwt", OAUTH: "oauth", XML: "xml", URL_INPUT: "urlInputs", FILE_INPUT: "fileInputs", BUSINESS_FLOW: "businessFlows", API_ENDPOINT: "apiEndpoints" };
  return technique.applicability === "ALWAYS" || surface[keys[technique.applicability]];
}
export function selectHuntTechniques(readiness: HuntReadiness, surface: HuntSurface, facts: ReadinessFacts, catalog = HUNT_TECHNIQUES) {
  const seen = new Set<string>();
  return catalog.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; }).map(technique => {
    const family = readiness.find(f => f.family === technique.family);
    const missing = technique.prerequisites.some(type => !prerequisiteSatisfied(type, facts));
    const reason = !family?.selected ? "NOT_SELECTED" : !family.safeSubset ? family.state : technique.implementation !== "IMPLEMENTED" ? technique.implementation : technique.requiresApproval || ["HIGH_RISK", "STATE_CHANGING"].includes(technique.risk) ? "REQUIRE_APPROVAL" : missing ? "PREREQUISITE_MISSING" : !isTechniqueApplicable(technique, surface) ? "NOT_APPLICABLE" : "APPLICABLE";
    return { technique, executable: reason === "APPLICABLE", reason };
  });
}
