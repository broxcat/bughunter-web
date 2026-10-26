import { describe, expect, it } from "vitest";
import { EMPTY_READINESS_FACTS as empty, resolveHuntReadiness } from "@/lib/hunt/readiness";
const assess = (family: string, facts = empty) => resolveHuntReadiness({ qualifying: [], nonQualifying: [] }, facts).find(f => f.family === family)!;
describe("Hunt readiness prerequisites", () => {
  it("blocks strong BOLA while allowing degraded IDOR discovery without an owned reference", () => {
    expect(assess("bola").state).toBe("BLOCKED");
    expect(assess("idor", { ...empty, primaryCredential: true, secondCredential: true }).state).toBe("DEGRADED");
    expect(assess("bola", { ...empty, primaryCredential: true, secondCredential: true, secondUserObjectReference: true, objectReference: true }).state).toBe("READY");
  });
  it("does not block public XSS/SQLi/access-control checks without credentials", () => {
    for (const f of ["xss", "sqli", "auth-bypass"]) expect(assess(f).state).toBe("DEGRADED");
  });
  it("explains CSRF session, stateful endpoint and browser gaps", () => {
    expect(assess("csrf").prerequisites.filter(p => !p.satisfied).map(p => p.type)).toEqual(["SESSION_COOKIE", "STATE_CHANGING_ENDPOINT", "BROWSER_CONTEXT"]);
    expect(assess("csrf", { ...empty, sessionCookie: true, browserContext: true }).state).toBe("DEGRADED");
  });
  it("blocks JWT and OAuth individually, and distinguishes completed discovery", () => {
    expect(assess("jwt").state).toBe("BLOCKED");
    expect(assess("jwt").prerequisites[0].reason).toContain("JWT_NOT_AVAILABLE");
    expect(assess("jwt", { ...empty, jwt: true }).state).toBe("READY");
    expect(assess("oauth").state).toBe("BLOCKED");
    expect(assess("oauth", { ...empty, discoveryComplete: true }).state).toBe("NOT_APPLICABLE");
    expect(assess("oauth", { ...empty, oauthFlow: true }).state).toBe("READY");
  });
  it("requires actual XML observations and explains missing OOB for blind checks", () => {
    expect(assess("xxe").state).toBe("BLOCKED");
    expect(assess("xxe", { ...empty, xmlEndpoint: true }).state).toBe("DEGRADED");
    expect(assess("xxe", { ...empty, xmlEndpoint: true, oobCallback: true }).state).toBe("READY");
    expect(assess("ssrf").state).toBe("DEGRADED");
  });
  it("excluded families stay NOT_SELECTED regardless of configured prerequisites", () => {
    expect(resolveHuntReadiness({ qualifying: ["XSS", "JWT"], nonQualifying: ["JWT"] }, { ...empty, jwt: true }).find(f => f.family === "jwt")?.state).toBe("NOT_SELECTED");
  });
});
