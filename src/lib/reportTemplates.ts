// Report rendering — one markdown template per bounty platform. Every finding
// follows the same industry-standard skeleton:
//
//   Title
//   CWE / CVSS 3.1 lines
//   Description
//   Impact
//   Proof of Concept
//   Remediation
//
// Platforms differ only in their small formatting specifics (heading text and the
// metadata line under the title). Sections that were never written are filled
// with an explicit placeholder rather than invented prose, and the prose that is
// present states facts, never "could potentially".

import { cvssRating } from "@/lib/cvss";
import { cweUrl } from "@/lib/cwe";
import { assessmentModeLabel,type AssessmentMode } from "@/lib/assessment";

export type ReportPlatform =
  | "HACKERONE"
  | "BUGCROWD"
  | "INTIGRITI"
  | "YESWEHACK"
  | "IMMUNEFI"
  | "GENERIC";

export interface ReportOobHit {
  receivedAt: Date | string;
  sourceIp?: string | null;
  method: string;
}

export interface ReportFinding {
  vaultEvidence?:Array<{id:string;kind:string;description:string;contentSha256?:string|null;role?:string}>;
  /** Captured execution provenance, never the current Program setting. */
  assessmentMode?: AssessmentMode | null;
  assessmentModeSource?: "RESEARCH_SESSION" | "SCAN_RUN" | "UNKNOWN";
  title: string;
  vulnClass?: string | null;
  severity?: string | null;
  description?: string | null;
  evidence?: string | null;
  location?: string | null;
  cwe?: string | null;
  cvssVector?: string | null;
  cvssScore?: number | null;
  impact?: string | null;
  remediation?: string | null;
  /** Correlated out-of-band callbacks (SSRF); part of the PoC when present. */
  oobHits?: ReportOobHit[];
}

export interface ReportInput {
  title: string;
  findings: ReportFinding[];
  /** Optional application-owned captured aggregate; the API derives it from findings. */
  assessmentMode?: AssessmentMode | "MIXED" | null;
}

/** A promoted finding belongs to its actual Research session. An uncaptured
 * legacy session stays unknown instead of borrowing the preceding Recon mode. */
export function capturedFindingAssessment(finding:{scanRun?:{assessmentModeSnapshot?:unknown}|null;researchPromotion?:{hypothesis?:{session?:{authorizationSnapshot?:unknown}|null}|null}|null}):Pick<ReportFinding,'assessmentMode'|'assessmentModeSource'>{
  if(finding.researchPromotion){
    const raw=finding.researchPromotion.hypothesis?.session?.authorizationSnapshot;
    const mode=raw&&typeof raw==='object'&&!Array.isArray(raw)?(raw as Record<string,unknown>).assessmentMode:null;
    return{assessmentMode:mode==='BLACK_BOX'||mode==='WHITE_BOX'?mode:null,assessmentModeSource:'RESEARCH_SESSION'};
  }
  const mode=finding.scanRun?.assessmentModeSnapshot;
  return{assessmentMode:mode==='BLACK_BOX'||mode==='WHITE_BOX'?mode:null,assessmentModeSource:finding.scanRun?'SCAN_RUN':'UNKNOWN'};
}
function aggregateAssessmentMode(input:ReportInput):string{
  if(input.assessmentMode!==undefined)return input.assessmentMode==='MIXED'?'Mixed captured modes':assessmentModeLabel(input.assessmentMode);
  const modes=new Set(input.findings.map(finding=>finding.assessmentMode??null));
  if(modes.size>1)return modes.has(null)?'Mixed / includes legacy uncaptured modes':'Mixed captured modes';
  return assessmentModeLabel(input.findings[0]?.assessmentMode);
}

export const IMPACT_PLACEHOLDER = "À compléter : impact business/technique démontré";
export const REMEDIATION_PLACEHOLDER = "Remediation guidance not yet documented.";
export const POC_PLACEHOLDER = "À compléter : étapes de reproduction (requêtes / réponses).";
export const DESCRIPTION_PLACEHOLDER = "À compléter : description de la vulnérabilité.";

function sev(f: ReportFinding): string {
  return (f.severity ?? "INFO").toUpperCase();
}

function text(v?: string | null): string {
  return (v ?? "").trim();
}

function cweLine(f: ReportFinding): string {
  const cwe = text(f.cwe);
  if (!cwe) return "CWE: not yet assigned";
  const url = cweUrl(cwe);
  return url ? `CWE: ${cwe} — [${url.replace("https://", "")}](${url})` : `CWE: ${cwe}`;
}

function cvssLine(f: ReportFinding): string {
  const vector = text(f.cvssVector);
  if (f.cvssScore === null || f.cvssScore === undefined || !vector) {
    return "CVSS 3.1 Score: not yet scored";
  }
  return `CVSS 3.1 Score: ${f.cvssScore.toFixed(1)} (${cvssRating(f.cvssScore)}) — Vector: ${vector}`;
}

function oobLines(hits: ReportOobHit[]): string {
  const lines = hits.map((h) => {
    const at = h.receivedAt instanceof Date ? h.receivedAt : new Date(h.receivedAt);
    return `- ${h.method} from ${h.sourceIp ?? "unknown"} at ${at.toISOString()}`;
  });
  return [
    `Out-of-band callback${hits.length === 1 ? "" : "s"} received by the self-hosted catcher (${hits.length}):`,
    ...lines,
  ].join("\n");
}

/**
 * Proof of Concept = the confirmation data already stored on the finding: its
 * location, its evidence (for XSS this is the confirmed sink evidence), and any
 * correlated OOB callbacks (SSRF). Empty ⇒ explicit placeholder.
 */
function proofOfConcept(f: ReportFinding): string {
  const parts: string[] = [];
  if (text(f.location)) parts.push(`Affected location: \`${text(f.location)}\``);
  if (text(f.evidence)) parts.push(text(f.evidence));
  if(f.vaultEvidence?.length){const escape=(v:string)=>v.replace(/[\r\n]/g,' ').replace(/([\\`*_{}\[\]<>|#])/g,'\\$1');parts.push('Evidence Vault references (same durable IDs; provenance retained in BugHunter):\n'+f.vaultEvidence.map(e=>`- ${escape(e.id)} · ${escape(e.kind)}${e.role?' · '+escape(e.role):''} · ${escape(e.description)}${e.contentSha256?' · SHA-256 '+e.contentSha256:''}`).join('\n'));}
  if (f.oobHits && f.oobHits.length > 0) parts.push(oobLines(f.oobHits));
  return parts.length ? parts.join("\n\n") : POC_PLACEHOLDER;
}

/** The shared per-finding skeleton. `heading` and `meta` are the platform bits. */
function renderFinding(
  f: ReportFinding,
  heading: string,
  meta: string,
): string {
  return [
    heading,
    meta,
    `Assessment mode: ${assessmentModeLabel(f.assessmentMode)}`,
    `Assessment provenance: ${f.assessmentModeSource==='RESEARCH_SESSION'?'Research session authorization snapshot':f.assessmentModeSource==='SCAN_RUN'?'Recon ScanRun snapshot':'Not captured'}`,
    "",
    cweLine(f),
    cvssLine(f),
    "",
    "#### Description",
    "",
    text(f.description) || DESCRIPTION_PLACEHOLDER,
    "",
    "#### Impact",
    "",
    text(f.impact) || IMPACT_PLACEHOLDER,
    "",
    "#### Proof of Concept",
    "",
    proofOfConcept(f),
    "",
    "#### Remediation",
    "",
    text(f.remediation) || REMEDIATION_PLACEHOLDER,
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

// --- Per-platform headings + metadata line (the platform-specific formatting). ---

function hackeroneFinding(f: ReportFinding, i: number): string {
  return renderFinding(
    f,
    `### ${i + 1}. ${f.title}`,
    `**Severity:** ${sev(f)}${f.vulnClass ? `  ·  **Weakness:** ${f.vulnClass}` : ""}`,
  );
}

function bugcrowdFinding(f: ReportFinding, i: number): string {
  return renderFinding(
    f,
    `### ${i + 1}. ${f.title} (${sev(f)})`,
    f.vulnClass ? `VRT / Bug class: ${f.vulnClass}` : "",
  );
}

function intigritiFinding(f: ReportFinding, i: number): string {
  return renderFinding(
    f,
    `### ${i + 1}. ${f.title}`,
    `Severity: ${sev(f)}${f.vulnClass ? ` — ${f.vulnClass}` : ""}`,
  );
}

function yeswehackFinding(f: ReportFinding, i: number): string {
  return renderFinding(
    f,
    `### ${i + 1}. ${f.title}`,
    `**Severity:** ${sev(f)}${f.vulnClass ? `  ·  **Bug type:** ${f.vulnClass}` : ""}`,
  );
}

function immunefiFinding(f: ReportFinding, i: number): string {
  return renderFinding(
    f,
    `### ${i + 1}. ${f.title}`,
    `**Severity:** ${sev(f)}${f.vulnClass ? `  ·  **Class:** ${f.vulnClass}` : ""}`,
  );
}

function genericFinding(f: ReportFinding, i: number): string {
  return renderFinding(
    f,
    `### ${i + 1}. ${f.title}`,
    [`- Severity: ${sev(f)}`, f.vulnClass ? `- Class: ${f.vulnClass}` : ""]
      .filter(Boolean)
      .join("\n"),
  );
}

const RENDERERS: Record<
  ReportPlatform,
  { heading: string; finding: (f: ReportFinding, i: number) => string }
> = {
  HACKERONE: { heading: "HackerOne Report", finding: hackeroneFinding },
  BUGCROWD: { heading: "Bugcrowd Submission", finding: bugcrowdFinding },
  INTIGRITI: { heading: "Intigriti Submission", finding: intigritiFinding },
  YESWEHACK: { heading: "YesWeHack Report", finding: yeswehackFinding },
  IMMUNEFI: { heading: "Immunefi Bug Report", finding: immunefiFinding },
  GENERIC: { heading: "Security Report", finding: genericFinding },
};

/**
 * Render a full markdown report for one platform, one section per finding. Only
 * findings that have passed the gate should ever reach here (enforced by the API
 * layer).
 */
export function renderReport(platform: ReportPlatform, input: ReportInput): string {
  const r = RENDERERS[platform] ?? RENDERERS.GENERIC;
  const { title, findings } = input;

  const header = [
    `# ${title}`,
    "",
    `_${r.heading} — ${findings.length} finding${findings.length === 1 ? "" : "s"}_`,
    `Assessment mode: ${aggregateAssessmentMode(input)}`,
    "The mode describes captured assessment context; it does not establish source-analysis coverage or expand authorization.",
    "",
  ].join("\n");

  if (findings.length === 0) {
    return header + "\n_No findings included._\n";
  }

  const body = findings.map((f, i) => r.finding(f, i)).join("\n\n---\n\n");

  return `${header}\n${body}\n`;
}
