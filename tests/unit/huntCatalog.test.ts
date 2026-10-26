import { describe, expect, it } from "vitest";
import { HUNT_TECHNIQUES } from "@/lib/hunt/catalogData";
import { EMPTY_HUNT_SURFACE, selectHuntTechniques } from "@/lib/hunt/catalog";
import { EMPTY_READINESS_FACTS, HUNT_FAMILY_REGISTRY, resolveHuntReadiness } from "@/lib/hunt/readiness";
describe("versioned reference-driven technique catalogue", () => {
  it("documents multiple methods and four researched source classes per family", () => {
    expect(new Set(HUNT_TECHNIQUES.map(t => t.id)).size).toBe(HUNT_TECHNIQUES.length);
    for (const family of HUNT_FAMILY_REGISTRY) {
      const techniques = HUNT_TECHNIQUES.filter(t => t.family === family.family);
      expect(techniques.length).toBeGreaterThanOrEqual(2);
      for (const t of techniques) {
        expect(t.references.map(r => r.referenceSource)).toEqual(expect.arrayContaining(["OWASP_WSTG", "OWASP_CHEAT_SHEET", "PORTSWIGGER_ACADEMY", "HACKTRICKS"]));
        expect(t.confirmationEvidence).toBeTruthy(); expect(t.negativeControls.length).toBeGreaterThan(0);
      }
    }
  });
  it("never automatically executes planned, unsupported, state-changing or high-risk methods", () => {
    const decisions = selectHuntTechniques(resolveHuntReadiness({ qualifying: [], nonQualifying: [] }, EMPTY_READINESS_FACTS), EMPTY_HUNT_SURFACE, EMPTY_READINESS_FACTS);
    expect(decisions.filter(d => d.technique.implementation !== "IMPLEMENTED" || d.technique.requiresApproval).every(d => !d.executable)).toBe(true);
    for (const t of HUNT_TECHNIQUES.filter(t => ["STATE_CHANGING", "HIGH_RISK"].includes(t.risk))) expect(t.requiresApproval).toBe(true);
  });
  it("uses applicability, required facts and deduplication for executable descriptors", () => {
    const t = { ...HUNT_TECHNIQUES.find(t => t.id === "xss.reflection")!, implementation: "IMPLEMENTED" as const };
    const readiness = resolveHuntReadiness({ qualifying: ["XSS"], nonQualifying: [] }, EMPTY_READINESS_FACTS);
    expect(selectHuntTechniques(readiness, EMPTY_HUNT_SURFACE, EMPTY_READINESS_FACTS, [t])[0].reason).toBe("NOT_APPLICABLE");
    expect(selectHuntTechniques(readiness, { ...EMPTY_HUNT_SURFACE, queryInputs: true }, EMPTY_READINESS_FACTS, [t, t])).toHaveLength(1);
    expect(selectHuntTechniques(readiness, { ...EMPTY_HUNT_SURFACE, queryInputs: true }, EMPTY_READINESS_FACTS, [t])[0].executable).toBe(true);
  });
});
