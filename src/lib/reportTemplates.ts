// Report rendering — one markdown template per bounty platform. Impact-first:
// the reader learns what an attacker can do before anything else, and the prose
// states facts ("an attacker can…"), never "could potentially".

export type ReportPlatform =
  | "HACKERONE"
  | "BUGCROWD"
  | "INTIGRITI"
  | "IMMUNEFI"
  | "GENERIC";

export interface ReportFinding {
  title: string;
  vulnClass?: string | null;
  severity?: string | null;
  description?: string | null;
  evidence?: string | null;
}

export interface ReportInput {
  title: string;
  findings: ReportFinding[];
}

function sev(f: ReportFinding): string {
  return (f.severity ?? "INFO").toUpperCase();
}

function section(label: string, body?: string | null): string {
  const content = (body ?? "").trim();
  return `**${label}:** ${content.length ? content : "_See evidence below._"}`;
}

// --- Per-finding bodies, shaped to each platform's expected report fields. ---

function hackeroneFinding(f: ReportFinding, i: number): string {
  return [
    `### ${i + 1}. ${f.title}`,
    `**Severity:** ${sev(f)}${f.vulnClass ? `  ·  **Weakness:** ${f.vulnClass}` : ""}`,
    "",
    "#### Summary",
    (f.description ?? "").trim() ||
      "An attacker can abuse this issue against the target as described below.",
    "",
    "#### Steps To Reproduce",
    (f.evidence ?? "").trim() || "_Reproduction steps / request captured in the evidence bundle._",
    "",
    "#### Impact",
    `This gives an attacker a concrete, ${sev(f).toLowerCase()}-severity foothold against the target and its users.`,
  ].join("\n");
}

function bugcrowdFinding(f: ReportFinding, i: number): string {
  return [
    `### ${i + 1}. ${f.title} (${sev(f)})`,
    f.vulnClass ? `VRT / Bug class: ${f.vulnClass}` : "",
    "",
    section("Description", f.description),
    "",
    section("Proof of Concept", f.evidence),
    "",
    section(
      "Impact",
      `An attacker can exploit this to achieve ${sev(f).toLowerCase()}-severity impact on the target.`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

function intigritiFinding(f: ReportFinding, i: number): string {
  return [
    `### ${i + 1}. ${f.title}`,
    `Severity: ${sev(f)}${f.vulnClass ? ` — ${f.vulnClass}` : ""}`,
    "",
    "**Description of the vulnerability**",
    (f.description ?? "").trim() || "The target is affected as detailed below.",
    "",
    "**Proof of concept**",
    (f.evidence ?? "").trim() || "_Evidence attached._",
    "",
    "**Impact**",
    `An attacker exploiting this achieves ${sev(f).toLowerCase()}-severity impact against the target.`,
  ].join("\n");
}

function immunefiFinding(f: ReportFinding, i: number): string {
  return [
    `### ${i + 1}. ${f.title}`,
    `**Severity:** ${sev(f)}${f.vulnClass ? `  ·  **Class:** ${f.vulnClass}` : ""}`,
    "",
    "#### Vulnerability Details",
    (f.description ?? "").trim() || "See the proof of concept below.",
    "",
    "#### Proof of Concept",
    (f.evidence ?? "").trim() || "_PoC provided in the evidence bundle._",
    "",
    "#### Impact in Production",
    `An attacker exploiting this on-chain/in-production causes ${sev(f).toLowerCase()}-severity loss or compromise.`,
  ].join("\n");
}

function genericFinding(f: ReportFinding, i: number): string {
  return [
    `### ${i + 1}. ${f.title}`,
    `- Severity: ${sev(f)}`,
    f.vulnClass ? `- Class: ${f.vulnClass}` : "",
    "",
    section("Description", f.description),
    "",
    section("Evidence", f.evidence),
    "",
    section(
      "Impact",
      `An attacker can exploit this for ${sev(f).toLowerCase()}-severity impact.`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

const RENDERERS: Record<
  ReportPlatform,
  { heading: string; finding: (f: ReportFinding, i: number) => string }
> = {
  HACKERONE: { heading: "HackerOne Report", finding: hackeroneFinding },
  BUGCROWD: { heading: "Bugcrowd Submission", finding: bugcrowdFinding },
  INTIGRITI: { heading: "Intigriti Submission", finding: intigritiFinding },
  IMMUNEFI: { heading: "Immunefi Bug Report", finding: immunefiFinding },
  GENERIC: { heading: "Security Report", finding: genericFinding },
};

/**
 * Render a full markdown report for one platform. Impact-first, one section
 * per finding. Only findings that have passed the gate should ever reach here
 * (enforced by the API layer).
 */
export function renderReport(platform: ReportPlatform, input: ReportInput): string {
  const r = RENDERERS[platform] ?? RENDERERS.GENERIC;
  const { title, findings } = input;

  const header = [
    `# ${title}`,
    "",
    `_${r.heading} — ${findings.length} finding${findings.length === 1 ? "" : "s"}_`,
    "",
  ].join("\n");

  if (findings.length === 0) {
    return header + "\n_No findings included._\n";
  }

  const body = findings.map((f, i) => r.finding(f, i)).join("\n\n---\n\n");

  return `${header}\n${body}\n`;
}
