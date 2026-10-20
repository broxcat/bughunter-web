// Bug bounty program policy attached to a Scope. Single source of truth for the
// field list, the section labels (same wording as the standard "Bug Bounty
// Program Structure" used by HackerOne / YesWeHack / Bugcrowd), and validation.
//
// These fields are INFORMATIONAL: they are shown while hunting as a reminder of
// the program's rules. Scan authorization is decided solely by Scope.status.

import { z } from "zod";

export const PROGRAM_PLATFORMS = [
  "HACKERONE",
  "BUGCROWD",
  "INTIGRITI",
  "YESWEHACK",
  "IMMUNEFI",
  "GENERIC",
] as const;

export type ProgramPlatform = (typeof PROGRAM_PLATFORMS)[number];

export const POLICY_TEXT_FIELDS = [
  "vendorResponseSla",
  "accessInfo",
  "eligibilityCriteria",
  "disclosurePolicy",
  "rulesOfEngagement",
  "scopeDetails",
  "outOfScope",
  "reportingFormat",
  "rewardsTable",
  "safeHarbor",
  "legalTerms",
  "contactInfo",
] as const;

export type PolicyTextField = (typeof POLICY_TEXT_FIELDS)[number];

export interface PolicySection {
  field: PolicyTextField;
  label: string;
  hint: string;
  /** Rendered with the warning emphasis in the hunt-time reminder. */
  emphasis?: boolean;
}

/** Display order matches the standard program structure table. */
export const POLICY_SECTIONS: PolicySection[] = [
  {
    field: "vendorResponseSla",
    label: "Vendor Response SLAs",
    hint: "Time to first response, triage, bounty and resolution.",
  },
  {
    field: "accessInfo",
    label: "Access",
    hint: "How to get access: invitation, test accounts, VPN, allow-listing.",
  },
  {
    field: "eligibilityCriteria",
    label: "Eligibility Criteria",
    hint: "Who may participate and which reports qualify (duplicates, age, residency…).",
  },
  {
    field: "disclosurePolicy",
    label: "Responsible Disclosure Policy",
    hint: "Disclosure rules and timelines.",
  },
  {
    field: "rulesOfEngagement",
    label: "Rules of Engagement",
    hint: "Allowed and forbidden testing (rate limits, no DoS, no data exfiltration, no social engineering…).",
    emphasis: true,
  },
  {
    field: "scopeDetails",
    label: "Scope",
    hint: "In-scope assets beyond the host pattern: domains, IP ranges, mobile apps, APIs.",
  },
  {
    field: "outOfScope",
    label: "Out of Scope",
    hint: "Assets and vulnerability classes explicitly excluded.",
    emphasis: true,
  },
  {
    field: "reportingFormat",
    label: "Reporting Format",
    hint: "Program-specific requirements for report submission.",
  },
  {
    field: "rewardsTable",
    label: "Rewards",
    hint: "Reward grid by severity, if published.",
  },
  {
    field: "safeHarbor",
    label: "Safe Harbor",
    hint: "Legal protection promised to good-faith researchers.",
  },
  {
    field: "legalTerms",
    label: "Legal Terms and Conditions",
    hint: "Program terms you accept by participating.",
  },
  {
    field: "contactInfo",
    label: "Contact Information",
    hint: "Security contact or program email.",
  },
];

const optionalText = z
  .string()
  .trim()
  .max(20000, "Too long (max 20000 characters)")
  .optional();

/** Zod shape for the optional policy fields (shared by create and update). */
export const policyShape = {
  platform: z.enum(PROGRAM_PLATFORMS).optional(),
  vendorResponseSla: optionalText,
  accessInfo: optionalText,
  eligibilityCriteria: optionalText,
  disclosurePolicy: optionalText,
  rulesOfEngagement: optionalText,
  scopeDetails: optionalText,
  outOfScope: optionalText,
  reportingFormat: optionalText,
  rewardsTable: optionalText,
  safeHarbor: optionalText,
  legalTerms: optionalText,
  contactInfo: optionalText,
};

/** Update schema: every field optional; an empty string clears the field. */
export const updatePolicySchema = z.object({
  ...policyShape,
  platform: z.enum(PROGRAM_PLATFORMS).nullable().optional(),
});

/** Empty / whitespace-only strings are stored as null rather than "". */
export function nullIfBlank(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v.length ? v : null;
}
