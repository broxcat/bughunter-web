import { describe, it, expect } from "vitest";
import {
  IMPACT_PLACEHOLDER,
  POC_PLACEHOLDER,
  REMEDIATION_PLACEHOLDER,
  renderReport,
  type ReportFinding,
  type ReportPlatform,
} from "@/lib/reportTemplates";

const PLATFORMS: ReportPlatform[] = [
  "HACKERONE",
  "BUGCROWD",
  "INTIGRITI",
  "YESWEHACK",
  "IMMUNEFI",
  "GENERIC",
];

const FULL: ReportFinding = {
  title: "Reflected XSS in search",
  vulnClass: "XSS",
  severity: "HIGH",
  description: "The q parameter is reflected unescaped.",
  evidence: "Payload executed; sink confirmed in a real browser.",
  location: "/search?q=",
  cwe: "CWE-79",
  cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
  cvssScore: 6.1,
  impact: "Session theft for any user who opens a crafted link.",
  remediation: "Contextually encode output.",
};

const EMPTY: ReportFinding = { title: "Bare finding", severity: "LOW" };

function sectionOrder(md: string): number[] {
  return ["#### Description", "#### Impact", "#### Proof of Concept", "#### Remediation"].map(
    (h) => md.indexOf(h),
  );
}

describe("report skeleton", () => {
  it.each(PLATFORMS)("%s: every finding follows the standard section order", (p) => {
    const md = renderReport(p, { title: "T", findings: [FULL, EMPTY] });
    const first = md.split("\n\n---\n\n")[0];
    const idx = sectionOrder(first);
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(first.indexOf("CWE:")).toBeLessThan(idx[0]);
    expect(first.indexOf("CVSS 3.1 Score:")).toBeLessThan(idx[0]);
  });

  it("renders CWE with a MITRE link and the CVSS score, rating and vector", () => {
    const md = renderReport("HACKERONE", { title: "T", findings: [FULL] });
    expect(md).toContain(
      "CWE: CWE-79 — [cwe.mitre.org/data/definitions/79.html](https://cwe.mitre.org/data/definitions/79.html)",
    );
    expect(md).toContain(
      "CVSS 3.1 Score: 6.1 (Medium) — Vector: CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
    );
  });

  it("uses stored text and never invents impact or remediation", () => {
    const md = renderReport("GENERIC", { title: "T", findings: [FULL] });
    expect(md).toContain("Session theft for any user");
    expect(md).toContain("Contextually encode output.");
    expect(md).not.toContain(IMPACT_PLACEHOLDER);
    expect(md).not.toContain(REMEDIATION_PLACEHOLDER);
  });

  it("falls back to explicit placeholders when sections are empty", () => {
    const md = renderReport("GENERIC", { title: "T", findings: [EMPTY] });
    expect(md).toContain("À compléter : impact business/technique démontré");
    expect(md).toContain("Remediation guidance not yet documented.");
    expect(md).toContain(POC_PLACEHOLDER);
    expect(md).toContain("CWE: not yet assigned");
    expect(md).toContain("CVSS 3.1 Score: not yet scored");
    expect(md).not.toMatch(/could potentially/i);
  });

  it("puts location, evidence and OOB callbacks into the proof of concept", () => {
    const ssrf: ReportFinding = {
      title: "Blind SSRF",
      vulnClass: "SSRF",
      severity: "HIGH",
      location: "?url=",
      evidence: "Callback URL embedded in the url parameter.",
      oobHits: [
        { receivedAt: new Date("2026-10-20T10:00:00Z"), sourceIp: "203.0.113.7", method: "GET" },
      ],
    };
    const md = renderReport("INTIGRITI", { title: "T", findings: [ssrf] });
    const poc = md.slice(md.indexOf("#### Proof of Concept"), md.indexOf("#### Remediation"));
    expect(poc).toContain("Affected location: `?url=`");
    expect(poc).toContain("Callback URL embedded in the url parameter.");
    expect(poc).toContain("GET from 203.0.113.7 at 2026-10-20T10:00:00.000Z");
  });

  it("keeps the per-platform heading and metadata specifics", () => {
    const md = (p: ReportPlatform) => renderReport(p, { title: "T", findings: [FULL] });
    expect(md("HACKERONE")).toContain("HackerOne Report");
    expect(md("HACKERONE")).toContain("**Weakness:** XSS");
    expect(md("BUGCROWD")).toContain("(HIGH)");
    expect(md("BUGCROWD")).toContain("VRT / Bug class: XSS");
    expect(md("YESWEHACK")).toContain("YesWeHack Report");
    expect(md("YESWEHACK")).toContain("**Bug type:** XSS");
    expect(md("IMMUNEFI")).toContain("Immunefi Bug Report");
  });

  it("handles an empty finding list", () => {
    expect(renderReport("YESWEHACK", { title: "T", findings: [] })).toContain(
      "_No findings included._",
    );
  });
});
