import { HUNT_REFERENCES } from "./references";
import { HUNT_TECHNIQUES } from "./catalogData";
import { HUNT_CAPABILITIES, resolveHuntFamilies, type HuntFamily, type HuntPolicy } from "./policy";

export const PREREQUISITE_TYPES = ["AUTHENTICATED_SESSION", "SESSION_COOKIE", "PRIMARY_CREDENTIAL", "SECOND_CREDENTIAL", "JWT", "OAUTH_FLOW", "OOB_CALLBACK", "XML_ENDPOINT", "STATE_CHANGING_ENDPOINT", "OBJECT_REFERENCE", "SECOND_USER_OBJECT_REFERENCE", "BROWSER_CONTEXT"] as const;
export type PrerequisiteType = typeof PREREQUISITE_TYPES[number];
export type HuntRisk = "PASSIVE" | "SAFE_ACTIVE" | "STATE_CHANGING" | "HIGH_RISK";
export interface PrerequisiteDefinition { type: PrerequisiteType; level: "required" | "recommended"; reason: string }
export interface HuntFamilyDescriptor {
  family: HuntFamily; displayName: string; supported: boolean;
  prerequisites: PrerequisiteDefinition[]; techniques: string[]; riskClass: HuntRisk;
  references: { referenceTitle: string; referenceUrl: string }[];
}
const req = (type: PrerequisiteType, reason: string): PrerequisiteDefinition => ({ type, reason, level: "required" });
const rec = (type: PrerequisiteType, reason: string): PrerequisiteDefinition => ({ type, reason, level: "recommended" });
const session = rec("AUTHENTICATED_SESSION", "A configured session improves coverage of protected routes; public checks remain available.");
const objects = rec("OBJECT_REFERENCE", "Discover an actual object reference before testing object access.");
const twoAccounts = [req("PRIMARY_CREDENTIAL", "No verified test session available."), req("SECOND_CREDENTIAL", "A second independent test session has not been verified."), req("SECOND_USER_OBJECT_REFERENCE", "No independently owned test object was discovered.")];
const definitions: Record<HuntFamily, { prerequisites: PrerequisiteDefinition[]; riskClass: HuntRisk; techniques: string[] }> = {
  "auth-bypass": { prerequisites: [session], riskClass: "SAFE_ACTIVE", techniques: ["auth.public-baseline", "auth.read-differential"] },
  idor: { prerequisites: [...twoAccounts.map(p => ({ ...p, level: "recommended" as const })), objects], riskClass: "SAFE_ACTIVE", techniques: ["idor.reference-discovery", "idor.account-differential"] },
  bola: { prerequisites: [...twoAccounts, objects], riskClass: "SAFE_ACTIVE", techniques: ["bola.account-differential", "bola.anonymous-control"] },
  xss: { prerequisites: [session, rec("BROWSER_CONTEXT", "A browser is needed to independently confirm safe script execution.")], riskClass: "SAFE_ACTIVE", techniques: ["xss.reflection", "xss.dom-source-sink"] },
  csrf: { prerequisites: [rec("SESSION_COOKIE", "A configured session cookie is needed for authenticated CSRF coverage."), rec("STATE_CHANGING_ENDPOINT", "Discover an actual state-changing endpoint; do not submit it automatically."), rec("BROWSER_CONTEXT", "Browser behavior is needed for a complete CSRF proof.")], riskClass: "PASSIVE", techniques: ["csrf.form-inventory", "csrf.cookie-metadata"] },
  sqli: { prerequisites: [session], riskClass: "SAFE_ACTIVE", techniques: ["sqli.error-differential", "sqli.paired-timing"] },
  "command-injection": { prerequisites: [session], riskClass: "SAFE_ACTIVE", techniques: ["cmdi.input-discovery", "cmdi.paired-timing"] },
  ssrf: { prerequisites: [rec("OOB_CALLBACK", "A configured operator-owned callback is required for blind SSRF confirmation.")], riskClass: "SAFE_ACTIVE", techniques: ["ssrf.url-input-discovery", "ssrf.controlled-oob"] },
  xxe: { prerequisites: [req("XML_ENDPOINT", "An observed XML-accepting endpoint is required."), rec("OOB_CALLBACK", "A configured operator-owned callback is needed for blind XXE.")], riskClass: "SAFE_ACTIVE", techniques: ["xxe.xml-inventory", "xxe.controlled-oob"] },
  ssti: { prerequisites: [session], riskClass: "SAFE_ACTIVE", techniques: ["ssti.arithmetic-differential", "ssti.literal-control"] },
  cors: { prerequisites: [session], riskClass: "SAFE_ACTIVE", techniques: ["cors.origin-matrix", "cors.sensitive-comparison"] },
  jwt: { prerequisites: [req("JWT", "JWT_NOT_AVAILABLE: no JWT observed in a verified test session or authorized corpus.")], riskClass: "SAFE_ACTIVE", techniques: ["jwt.claims-audit", "jwt.validation-differential", "jwt.algorithm-differential", "jwt.key-selection-review"] },
  oauth: { prerequisites: [req("OAUTH_FLOW", "An observed OAuth/OIDC authorization flow is required.")], riskClass: "SAFE_ACTIVE", techniques: ["oauth.flow-inventory", "oauth.flow-controls"] },
  lfi: { prerequisites: [session], riskClass: "SAFE_ACTIVE", techniques: ["lfi.path-input-discovery", "lfi.path-error-differential"] },
  deserialization: { prerequisites: [], riskClass: "PASSIVE", techniques: ["serialization.cookie-signature", "serialization.input-signature"] },
  "business-logic-race": { prerequisites: [rec("AUTHENTICATED_SESSION", "A session is usually needed to inspect business workflows."), rec("STATE_CHANGING_ENDPOINT", "Observe the action and its intended limit; do not replay it automatically.")], riskClass: "PASSIVE", techniques: ["business.race-inventory", "business.replay-review"] },
  "business-logic-tamper": { prerequisites: [session], riskClass: "PASSIVE", techniques: ["business.critical-field-inventory", "business.value-review"] },
  "business-logic-workflow": { prerequisites: [session], riskClass: "PASSIVE", techniques: ["business.workflow-inventory", "business.transition-review"] },
  "information-disclosure": { prerequisites: [], riskClass: "SAFE_ACTIVE", techniques: ["disclosure.git-config", "disclosure.header-inventory"] },
};
export const HUNT_FAMILY_REGISTRY: HuntFamilyDescriptor[] = HUNT_CAPABILITIES.map(c => ({ family: c.family, displayName: c.displayName, supported: c.supported, ...definitions[c.family], references: HUNT_REFERENCES[c.family], techniques: HUNT_TECHNIQUES.filter(t => t.family === c.family).map(t => t.id) }));

export interface ReadinessFacts {
  publicXssSurface: boolean;
  primaryCredential: boolean; secondCredential: boolean; authenticatedSession: boolean;
  sessionCookie: boolean; jwt: boolean; oauthFlow: boolean; oobCallback: boolean;
  xmlEndpoint: boolean; stateChangingEndpoint: boolean; objectReference: boolean;
  secondUserObjectReference: boolean; browserContext: boolean; discoveryComplete: boolean;
}
export const EMPTY_READINESS_FACTS: ReadinessFacts = { publicXssSurface: false, primaryCredential: false, secondCredential: false, authenticatedSession: false, sessionCookie: false, jwt: false, oauthFlow: false, oobCallback: false, xmlEndpoint: false, stateChangingEndpoint: false, objectReference: false, secondUserObjectReference: false, browserContext: false, discoveryComplete: false };
const factKeys: Record<PrerequisiteType, keyof ReadinessFacts> = { PRIMARY_CREDENTIAL: "primaryCredential", SECOND_CREDENTIAL: "secondCredential", AUTHENTICATED_SESSION: "authenticatedSession", SESSION_COOKIE: "sessionCookie", JWT: "jwt", OAUTH_FLOW: "oauthFlow", OOB_CALLBACK: "oobCallback", XML_ENDPOINT: "xmlEndpoint", STATE_CHANGING_ENDPOINT: "stateChangingEndpoint", OBJECT_REFERENCE: "objectReference", SECOND_USER_OBJECT_REFERENCE: "secondUserObjectReference", BROWSER_CONTEXT: "browserContext" };
export const PREREQUISITE_LABELS: Record<PrerequisiteType, string> = { PRIMARY_CREDENTIAL: "Primary test credential", SECOND_CREDENTIAL: "Second independent test credential", AUTHENTICATED_SESSION: "Authenticated session", SESSION_COOKIE: "Session cookie", JWT: "JWT", OAUTH_FLOW: "OAuth/OIDC flow", OOB_CALLBACK: "Authorized OOB callback", XML_ENDPOINT: "Observed XML endpoint", STATE_CHANGING_ENDPOINT: "Observed state-changing endpoint", OBJECT_REFERENCE: "Object reference", SECOND_USER_OBJECT_REFERENCE: "Other test user's owned object reference", BROWSER_CONTEXT: "Browser confirmation" };
export function prerequisiteSatisfied(type: PrerequisiteType, facts: ReadinessFacts): boolean { return facts[factKeys[type]]; }
export type ReadinessState = "READY" | "DEGRADED" | "BLOCKED" | "NOT_APPLICABLE" | "NOT_SELECTED";
export function resolveHuntReadiness(policy: HuntPolicy, facts: ReadinessFacts) {
  return resolveHuntFamilies(policy).map(selection => {
    const descriptor = HUNT_FAMILY_REGISTRY.find(d => d.family === selection.family);
    const prerequisites = (descriptor?.prerequisites ?? []).filter(p => !(selection.family === "xss" && p.type === "AUTHENTICATED_SESSION" && facts.publicXssSurface)).map(p => ({ ...p, satisfied: prerequisiteSatisfied(p.type, facts) }));
    const missingRequired = prerequisites.filter(p => p.level === "required" && !p.satisfied);
    const missingRecommended = prerequisites.filter(p => p.level === "recommended" && !p.satisfied);
    const absentAfterDiscovery = facts.discoveryComplete && missingRequired.some(p => p.type === "XML_ENDPOINT" || p.type === "OAUTH_FLOW");
    const sessionUnavailable = !facts.authenticatedSession && missingRequired.some(p => ["PRIMARY_CREDENTIAL", "SECOND_CREDENTIAL", "AUTHENTICATED_SESSION", "SESSION_COOKIE"].includes(p.type));
    const state: ReadinessState = !selection.selected ? "NOT_SELECTED" : absentAfterDiscovery || sessionUnavailable ? "NOT_APPLICABLE" : missingRequired.length ? "BLOCKED" : missingRecommended.length ? "DEGRADED" : "READY";
    return { ...selection, state, prerequisites, riskClass: descriptor?.riskClass ?? "HIGH_RISK", safeSubset: state === "READY" || state === "DEGRADED" };
  });
}
export type HuntReadiness = ReturnType<typeof resolveHuntReadiness>;
