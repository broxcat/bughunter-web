import { describe, it, expect } from "vitest";
import { findingEvidenceLevel, huntCounts } from "@/lib/hunt/presentation";
import type { HuntReport } from "@/lib/hunt/report";
describe("Hunt evidence presentation", () => {
  it("never promotes legacy proven/timing candidates to confirmed", () => {
    expect(findingEvidenceLevel({ severity: "HIGH" })).toBe("CANDIDATE");
    expect(findingEvidenceLevel({ severity: "INFO" })).toBe("SIGNAL");
    expect(findingEvidenceLevel({ gateStatus: "PASSED" })).toBe("VALIDATED");
    expect(findingEvidenceLevel({ huntMetadata: { evidenceLevel: "CONFIRMED" } })).toBe("CONFIRMED");
    expect(findingEvidenceLevel({ huntMetadata: { evidenceLevel: "UNKNOWN" } })).toBe("CANDIDATE");
  });
  it("counts selected readiness independently of execution state", () => {
    const report = { families: [{ selected: true, readiness: "READY" }, { selected: true, readiness: "BLOCKED" }, { selected: true, readiness: "DEGRADED" }, { selected: false, readiness: "NOT_SELECTED" }] } as HuntReport;
    expect(huntCounts(report)).toEqual({ Selected: 3, Ready: 1, Blocked: 1, Degraded: 1 });
  });
});
