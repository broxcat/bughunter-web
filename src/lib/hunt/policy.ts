import { z } from "zod";

export const HUNT_CAPABILITIES = [
  { family: "auth-bypass", displayName: "Access control / authentication", policyNames: ["AUTHENTICATION", "ACCESS_CONTROL"], supported: true },
  { family: "idor", displayName: "IDOR reference discovery", policyNames: ["IDOR", "ACCESS_CONTROL"], supported: true },
  { family: "bola", displayName: "IDOR / BOLA account comparison", policyNames: ["IDOR", "ACCESS_CONTROL"], supported: true },
  { family: "xss", displayName: "XSS", policyNames: ["XSS"], supported: true },
  { family: "csrf", displayName: "CSRF", policyNames: ["CSRF"], supported: true },
  { family: "sqli", displayName: "SQL Injection", policyNames: ["SQL_INJECTION"], supported: true },
  { family: "command-injection", displayName: "Command injection", policyNames: ["RCE"], supported: true },
  { family: "ssrf", displayName: "SSRF", policyNames: ["SSRF"], supported: true },
  { family: "xxe", displayName: "XXE", policyNames: ["XXE"], supported: true },
  { family: "ssti", displayName: "SSTI", policyNames: ["SSTI", "RCE"], supported: true },
  { family: "cors", displayName: "CORS", policyNames: ["CORS"], supported: true },
  { family: "jwt", displayName: "JWT", policyNames: ["JWT", "AUTHENTICATION"], supported: true },
  { family: "oauth", displayName: "OAuth", policyNames: ["OAUTH", "AUTHENTICATION"], supported: true },
  { family: "lfi", displayName: "File inclusion / traversal", policyNames: ["LFI"], supported: true },
  { family: "deserialization", displayName: "Deserialization", policyNames: ["DESERIALIZATION", "RCE"], supported: true },
  { family: "business-logic-race", displayName: "Business logic — race", policyNames: ["BUSINESS_LOGIC"], supported: true },
  { family: "business-logic-tamper", displayName: "Business logic — value tampering", policyNames: ["BUSINESS_LOGIC"], supported: true },
  { family: "business-logic-workflow", displayName: "Business logic — workflow", policyNames: ["BUSINESS_LOGIC"], supported: true },
  { family: "information-disclosure", displayName: "Information disclosure", policyNames: ["INFORMATION_DISCLOSURE"], supported: true },
] as const;
export type HuntFamily = typeof HUNT_CAPABILITIES[number]["family"];
export interface HuntCapability { family: string; displayName: string; policyNames: readonly string[]; supported: boolean }
export interface HuntPolicy { qualifying: readonly string[]; nonQualifying: readonly string[] }
export const SELECTION_REASONS = ["QUALIFYING_SELECTED", "QUALIFYING_EMPTY_ALLOW_SUPPORTED", "NON_QUALIFYING_EXCLUDED", "UNSUPPORTED", "NOT_SELECTED"] as const;
export const selectionSchema = z.object({ family: z.string(), displayName: z.string(), selected: z.boolean(), reason: z.enum(SELECTION_REASONS) });
export type HuntFamilySelection = z.infer<typeof selectionSchema>;

/** Single source of policy decisions, shared by preview and actual execution. */
export function resolveHuntFamilies(program: HuntPolicy, capabilities: readonly HuntCapability[] = HUNT_CAPABILITIES): HuntFamilySelection[] {
  const knownNames = new Set(capabilities.flatMap(c => [...c.policyNames]));
  const unknown = [...new Set([...program.qualifying, ...program.nonQualifying])].filter(name => !knownNames.has(name));
  return [...capabilities, ...unknown.map(name => ({ family: name, displayName: name, policyNames: [name], supported: false }))].map(c => {
    const excluded = c.policyNames.some(n => program.nonQualifying.includes(n));
    const reason = excluded ? "NON_QUALIFYING_EXCLUDED" : !c.supported ? "UNSUPPORTED" : !program.qualifying.length ? "QUALIFYING_EMPTY_ALLOW_SUPPORTED" : c.policyNames.some(n => program.qualifying.includes(n)) ? "QUALIFYING_SELECTED" : "NOT_SELECTED";
    return { family: c.family, displayName: c.displayName, selected: reason === "QUALIFYING_SELECTED" || reason === "QUALIFYING_EMPTY_ALLOW_SUPPORTED", reason };
  });
}
export const huntPolicySnapshotSchema = z.object({
  version: z.literal(1), approvedTechniques: z.array(z.string()).default([]), capturedAt: z.iso.datetime(),
  qualifying: z.array(z.string()), nonQualifying: z.array(z.string()),
  selectedFamilies: z.array(z.string()), families: z.array(selectionSchema),
});
export type HuntPolicySnapshot = z.infer<typeof huntPolicySnapshotSchema>;
export function createHuntPolicySnapshot(program: HuntPolicy, now = new Date()): HuntPolicySnapshot {
  const families = resolveHuntFamilies(program);
  return { version: 1, approvedTechniques: [], capturedAt: now.toISOString(), qualifying: [...program.qualifying], nonQualifying: [...program.nonQualifying], selectedFamilies: families.filter(f => f.selected).map(f => f.family), families };
}
