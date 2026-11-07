import { z } from "zod";
import { requiredUserAgentSchema } from "./httpPolicy.mjs";

export const BOUNTY_PLATFORMS = ["YESWEHACK", "HACKERONE", "INTIGRITI", "BUGCROWD", "OTHER", "PRIVATE"] as const;
export const VULNERABILITY_FAMILIES = ["XSS", "SQL_INJECTION", "IDOR", "ACCESS_CONTROL", "AUTHENTICATION", "SSRF", "XXE", "LFI", "RFI", "CORS", "CSRF", "RCE", "BUSINESS_LOGIC", "INFORMATION_DISCLOSURE", "OPEN_REDIRECT", "SSTI", "JWT", "OAUTH", "DESERIALIZATION"] as const;

/** Reject URLs and whitespace; preserve wildcard identities without expansion. */
export function normalizeFqdn(input: string): string {
  const host = input.toLowerCase().replace(/\.$/, "");
  const domain = host.startsWith("*.") ? host.slice(2) : host;
  if (host.length > 253 || /\s/.test(input) || !domain.includes(".") || /^\d+(\.\d+){3}$/.test(domain) ||
      !domain.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error("Enter a FQDN such as api.example.com or *.example.com, without scheme, port, path, query or spaces");
  }
  return host;
}
export const fqdnSchema = z.string().transform((v, ctx) => {
  try { return normalizeFqdn(v); } catch (e) {
    ctx.addIssue({ code: "custom", message: (e as Error).message });
    return z.NEVER;
  }
});
const hosts = z.array(fqdnSchema).max(1000).refine(v => new Set(v).size === v.length, "Duplicate host");
const money = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/, "Use a positive decimal amount with at most 2 decimal places").nullable().optional();
export const programSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  platform: z.enum(BOUNTY_PLATFORMS).nullable().optional(),
  programUrl: z.url().refine(v => /^https?:\/\//.test(v), "HTTP(S) URL required").nullable().optional(),
  rewardCurrency: z.string().regex(/^[A-Z]{3}$/).default("EUR"),
  rewardLow: money, rewardMedium: money, rewardHigh: money, rewardCritical: money,
  requiredUserAgent: requiredUserAgentSchema,
  scopeHosts: hosts.default([]),
  scopeRules: hosts.default([]),
  rulesOfEngagement: z.string().trim().max(20000).nullable().optional(),
  outOfScope: hosts.default([]),
  qualifying: z.array(z.enum(VULNERABILITY_FAMILIES)).default([]),
  nonQualifying: z.array(z.enum(VULNERABILITY_FAMILIES)).default([]),
});
// Zod 4 applies nested defaults even under partial(). A PATCH must leave every
// absent policy field untouched, especially the wildcard discovery rules.
export const programUpdateSchema = programSchema.omit({ scopeHosts: true }).extend({
  expectedUpdatedAt:z.iso.datetime().optional(),
  rewardCurrency: programSchema.shape.rewardCurrency.removeDefault(),
  scopeRules: programSchema.shape.scopeRules.removeDefault(),
  outOfScope: programSchema.shape.outOfScope.removeDefault(),
  qualifying: programSchema.shape.qualifying.removeDefault(),
  nonQualifying: programSchema.shape.nonQualifying.removeDefault(),
}).partial();

/** A wildcard covers subdomains only. Explicit exclusions always win. */
export function matchesHost(host: string, rule: string): boolean {
  return rule.startsWith("*.") ? host.endsWith(rule.slice(1)) && host !== rule.slice(2) : host === rule;
}
/** Technical seeds only. Never rewrite the original authorization rules. */
export function reconSeeds(rules: readonly string[]): string[] {
  return [...new Set(rules.map(normalizeFqdn).map(rule => rule.startsWith('*.') ? rule.slice(2) : rule))];
}
export function isExcluded(host: string, exclusions: readonly string[]): boolean {
  // A wildcard overlapping an exclusion cannot be used as an execution target.
  return exclusions.some(rule => matchesHost(host, rule) || (host.startsWith("*.") && matchesHost(rule, host)));
}
export function familyAllowed(families: readonly string[], qualifying: readonly string[], nonQualifying: readonly string[]): boolean {
  return !families.some(f => nonQualifying.includes(f)) && (!qualifying.length || families.some(f => qualifying.includes(f)));
}
