import { describe, expect, it } from "vitest";
import { normalizeCookies, sessionState, SESSION_TTL_MS, connectionInputSchema, readinessSummary } from "@/lib/targetAuth";
import { detectCsrf } from "@/server/credentials/csrf";
import { findingReviewStatus, reviewDecision, evidenceReviewSchema } from "@/lib/evidenceReview";
import { readFileSync, existsSync } from "node:fs";
describe("black-box authentication input and session state", () => {
  it.each(["sid=abc", "Cookie: sid=abc; token=a=b==", " sid=abc ; token=a=b== "])("normalizes cookie pairs: %s", raw => {
    expect(normalizeCookies(raw).sid).toBe("abc");
  });
  it.each(["garbage", "sid=x\r\nAuthorization: secret", "sid=x; broken", "sid=x; sid=y", "sid=hello world", "Set-Cookie: sid=x", "sid=x; Path=/", "", "x=" + "a".repeat(9000)])("rejects malformed cookies without including the value in errors", raw => {
    expect(() => normalizeCookies(raw)).toThrow("Invalid session cookie");
  });
  it("handles cookie names safely without prototype assignment", () => {
    const cookies = normalizeCookies("__proto__=fixture; sid=abc");
    expect(Object.prototype.hasOwnProperty.call(cookies, "__proto__")).toBe(true);
    expect(cookies.sid).toBe("abc");
  });
  it("does not infer a valid session from stored credentials or an unchecked cookie", () => {
    expect(sessionState({})).toBe("UNKNOWN");
    expect(sessionState({ sessionStatus: "VALID" })).toBe("UNKNOWN");
    expect(sessionState({ sessionStatus: "INVALID", sessionCheckedAt: new Date() })).toBe("INVALID");
    expect(sessionState({ sessionStatus: "EXPIRED" })).toBe("EXPIRED");
    expect(sessionState({ sessionStatus: "VALID", sessionCheckedAt: new Date() })).toBe("VALID");
    expect(sessionState({ sessionStatus: "VALID", sessionCheckedAt: new Date(Date.now() - SESSION_TTL_MS - 1) })).toBe("EXPIRED");
    expect(sessionState({ sessionStatus: "VALID", sessionCheckedAt: new Date(), sessionExpiresAt: new Date(0) })).toBe("EXPIRED");
  });
  it("accepts usernames without assuming an email address and needs no internal endpoint", () => {
    expect(connectionInputSchema.safeParse({ mode: "EMAIL_PASSWORD", username: "local-user", password: "fixture" }).success).toBe(true);
    expect(connectionInputSchema.safeParse({ mode: "BEARER", bearerToken: "fixture" }).success).toBe(false);
  });
  it("keeps public Hunt ready with authenticated Hunt blocked until a session is verified", () => {
    expect(readinessSummary(true, true, false)).toMatchObject({ publicReady: true, authenticatedReady: false });
    expect(readinessSummary(true, true, true)).toMatchObject({ publicReady: true, authenticatedReady: true });
    expect(readinessSummary(false, true, true)).toMatchObject({ publicReady: false, authenticatedReady: false });
  });
});
describe("automatic ephemeral CSRF discovery", () => {
  it("discovers hidden inputs, meta, cookie and response headers", () => {
    const result = detectCsrf('<input type="hidden" name="csrf" value="hidden-fixture"><meta name="csrf-token" content="meta-fixture">', { "XSRF-TOKEN": "cookie%2Dfixture" }, { "x-csrf-token": "header-fixture" });
    expect(result.sources).toEqual(expect.arrayContaining(["HIDDEN_INPUT", "META", "COOKIE", "HEADER"]));
    expect(result.headers["x-xsrf-token"]).toBe("cookie-fixture");
    expect(result.headers["x-csrf-token"]).toBe("header-fixture");
  });
  it("ignores unrelated fields and invalid header values", () => {
    expect(detectCsrf('<input name="username">', {}, {}).sources).toEqual([]);
    expect(detectCsrf("", {}, { "x-csrf-token": "bad\r\nvalue" }).headers).toEqual({});
  });
});
describe("evidence review replaces the questionnaire", () => {
  it("preserves historical finding decisions without using old answers", () => {
    expect(findingReviewStatus({ gateStatus: "PASSED" })).toBe("CONFIRMED");
    expect(findingReviewStatus({ gateStatus: "KILLED" })).toBe("REJECTED");
    expect(findingReviewStatus({ reviewStatus: "INCONCLUSIVE", gateStatus: "PASSED" })).toBe("INCONCLUSIVE");
  });
  it("requires the review phase, reproducible evidence and scope for confirmation", () => {
    const finding = { reviewStatus: "CANDIDATE", evidence: "Local baseline and probe observations" };
    expect(reviewDecision(finding, "CONFIRMED", "Local reproduction demonstrates a read-only fixture impact", true)).toContain("Start");
    expect(reviewDecision(finding, "EVIDENCE_REVIEW", "", false)).toBeNull();
    const reviewing = { ...finding, reviewStatus: "EVIDENCE_REVIEW" };
    expect(reviewDecision(reviewing, "CONFIRMED", "Local reproduction demonstrates a read-only fixture impact", true)).toBeNull();
    expect(reviewDecision(reviewing, "CONFIRMED", "Local reproduction demonstrates a read-only fixture impact", false)).toContain("scope");
    expect(reviewDecision({ ...reviewing, evidence: null }, "CONFIRMED", "Local reproduction demonstrates fixture impact", true)).toContain("evidence");
  });
  it("accepts rejection/inconclusive explanations and rejects old answer submissions", () => {
    for (const status of ["REJECTED", "INCONCLUSIVE"] as const) expect(reviewDecision({ reviewStatus: "EVIDENCE_REVIEW" }, status, "Local controls did not reproduce the claimed behavior", false)).toBeNull();
    expect(evidenceReviewSchema.safeParse({ answers: { q1: true } }).success).toBe(false);
  });
  it("exposes only two simple authentication modes and no manual internal fields", () => {
    const ui = readFileSync("src/components/TargetAuthentication.tsx", "utf8");
    expect(ui).toContain("Username / password"); expect(ui).toContain("Session cookie"); expect(ui).toContain("Test connection");
    expect(ui).not.toMatch(/CSRF token|Login URL|login endpoint|Bearer token|Owned object URL|Credential purpose/);
    const readiness = readFileSync("src/components/HuntRequirements.tsx", "utf8");
    expect(readiness).toContain("Missing authenticated session"); expect(readiness).toContain("Ready for Hunt");
    expect(readiness).not.toMatch(/PREREQUISITE_LABELS|families\.map|Hunt requirements/);
    expect(existsSync("src/lib/gate.ts")).toBe(false);
    expect(readFileSync("src/app/(dashboard)/targets/[id]/findings/page.tsx", "utf8")).not.toMatch(/7.Question|GATE_QUESTIONS|Run gate/);
  });
});
