import { describe, it, expect } from "vitest";
import { normalizeFqdn, programSchema, programUpdateSchema, matchesHost, isExcluded, familyAllowed } from "@/lib/bountyProgram";

describe("bounty program contract", () => {
  it('does not erase wildcard scope rules or other policy fields in a partial update',()=>{
    expect(programUpdateSchema.parse({outOfScope:['admin.example.test']})).toEqual({outOfScope:['admin.example.test']});
    expect(programUpdateSchema.parse({requiredUserAgent:'laziza'})).toEqual({requiredUserAgent:'laziza'});
    expect(programUpdateSchema.parse({scopeRules:[]})).toEqual({scopeRules:[]});
  });
  it("requires explicit company and User-Agent", () => {
    expect(programSchema.safeParse({ companyName: "VINCI" }).success).toBe(false);
    for (const ua of ["", " ", "x\r\nInjected: y"]) expect(programSchema.safeParse({ companyName: "VINCI", requiredUserAgent: ua }).success).toBe(false);
    expect(programSchema.parse({ companyName: "VINCI", requiredUserAgent: "BugHunter/1.0", rewardLow: "125.10" }).rewardLow).toBe("125.10");
    expect(programSchema.safeParse({ companyName: "VINCI", requiredUserAgent: "BugHunter/1.0", rewardLow: 0.1 }).success).toBe(false);
  });
  it("normalizes DNS names without expanding wildcards", () => {
    expect(normalizeFqdn("API.Example.com.")).toBe("api.example.com");
    expect(normalizeFqdn("*.Example.com")).toBe("*.example.com");
    for (const v of [" https://example.com", "example.com/a", "example.com?q=1", "a b.com", "-x.com", "a..com", "example.com;id", "example.com:80", "*foo.com", "127.0.0.1"]) expect(() => normalizeFqdn(v)).toThrow();
  });
  it("rejects normalized duplicates", () => {
    expect(programSchema.safeParse({ companyName: "x", requiredUserAgent: "x", scopeHosts: ["A.com", "a.com."] }).success).toBe(false);
  });
  it("gives exclusions priority over wildcard scope", () => {
    expect(matchesHost("api.example.com", "*.example.com")).toBe(true);
    expect(matchesHost("example.com", "*.example.com")).toBe(false);
    expect(isExcluded("admin.example.com", ["admin.example.com"])).toBe(true);
    expect(isExcluded("api.example.com", ["admin.example.com"])).toBe(false);
  });
  it("allows supported families by default and prioritizes explicit exclusions", () => {
    expect(familyAllowed(["XSS"], [], [])).toBe(true);
    expect(familyAllowed(["XSS"], ["XSS"], ["XSS"])).toBe(false);
    expect(familyAllowed(["XSS"], ["SSRF"], [])).toBe(false);
  });
});
