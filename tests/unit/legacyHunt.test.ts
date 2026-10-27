import { describe, it, expect } from "vitest";
import { findingEvidenceLevel } from "@/lib/legacyHunt";
describe("Hunt evidence presentation", () => {
  it("never promotes legacy proven/timing candidates to confirmed", () => {
    expect(findingEvidenceLevel({ severity: "HIGH" })).toBe("CANDIDATE");
    expect(findingEvidenceLevel({ severity: "INFO" })).toBe("SIGNAL");
    expect(findingEvidenceLevel({ gateStatus: "PASSED" })).toBe("VALIDATED");
    expect(findingEvidenceLevel({ huntMetadata: { evidenceLevel: "CONFIRMED" } })).toBe("CONFIRMED");
    expect(findingEvidenceLevel({ huntMetadata: { evidenceLevel: "UNKNOWN" } })).toBe("CANDIDATE");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LegacyHuntReport from "@/components/LegacyHuntReport";
describe("legacy report rendering", () => {
  it.each([null, { version: 1 }, { version: 1, families: [], candidates: [] }, { olderFormat: { message: "Archived observation" } }])("renders old or partial stored report %j without requiring engine modules", report => {
    const html = renderToStaticMarkup(createElement(LegacyHuntReport, { report, snapshot: { approvedTechniques: ["historical"] } }));
    expect(html).toContain("retired vulnerability-family Hunt engine");
    expect(html).toContain("Historical read-only record");
    expect(html).not.toMatch(/Start Hunt|Run hunt|<button|<form/);
  });
});
