import { describe, expect, it } from "vitest";
import { createHuntPolicySnapshot, HUNT_CAPABILITIES, resolveHuntFamilies } from "@/lib/hunt/policy";
const selected = (qualifying: string[], nonQualifying: string[] = []) => resolveHuntFamilies({ qualifying, nonQualifying }).filter(f => f.selected).map(f => f.family).sort();
describe("deterministic Hunt selection", () => {
  it("selects only qualifying supported families and matching IDOR modules", () => {
    expect(selected(["XSS", "IDOR", "CSRF"])).toEqual(["bola", "csrf", "idor", "xss"]);
    expect(selected(["XSS", "IDOR", "CSRF"], ["CSRF"])).toEqual(["bola", "idor", "xss"]);
  });
  it("empty qualifying allows supported capabilities except explicit exclusions", () => {
    const plan = resolveHuntFamilies({ qualifying: [], nonQualifying: ["CSRF"] });
    expect(plan.find(f => f.family === "csrf")).toMatchObject({ selected: false, reason: "NON_QUALIFYING_EXCLUDED" });
    expect(plan.filter(f => f.selected)).toHaveLength(HUNT_CAPABILITIES.length - 1);
    expect(plan.find(f => f.family === "xss")?.reason).toBe("QUALIFYING_EMPTY_ALLOW_SUPPORTED");
  });
  it("unknown names never acquire execution capability", () => {
    expect(resolveHuntFamilies({ qualifying: ["UNKNOWN", "RFI"], nonQualifying: [] }).filter(f => f.selected)).toEqual([]);
    expect(resolveHuntFamilies({ qualifying: ["UNKNOWN"], nonQualifying: [] }).find(f => f.family === "UNKNOWN")?.reason).toBe("UNSUPPORTED");
    expect(resolveHuntFamilies({ qualifying: ["XSS"], nonQualifying: [] }, [{ family: "xss", displayName: "XSS", policyNames: ["XSS"], supported: false }])[0].reason).toBe("UNSUPPORTED");
  });
  it("captures independent policy arrays with stable reasons", () => {
    const policy = { qualifying: ["XSS"], nonQualifying: [] as string[] };
    const snapshot = createHuntPolicySnapshot(policy);
    policy.qualifying.push("SSRF"); policy.nonQualifying.push("XSS");
    expect(snapshot.qualifying).toEqual(["XSS"]);
    expect(snapshot.selectedFamilies).toEqual(["xss"]);
    expect(snapshot.families.find(f => f.family === "xss")?.reason).toBe("QUALIFYING_SELECTED");
  });
});
