import { describe, expect, it } from "vitest";
import { hypothesesDocumentSchema, hypothesisSchema, isEvidenceRef, safeHypothesisIssues, hypothesesJsonSchema } from "@/lib/research/hypotheses";
import { hypothesisSnapshot, sortHypotheses } from "@/server/research/hypotheses";
import { hypothesisFixture, hypothesesFixture } from "../fixtures/hypotheses";

describe("strict hypothesis JSON contract", () => {
  it("validates a versioned document and generates a strict structural JSON Schema", () => {
    expect(hypothesesDocumentSchema.parse(hypothesesFixture()).hypotheses).toHaveLength(1);
    expect(hypothesesJsonSchema()).toMatchObject({ type: "object", additionalProperties: false });
  });
  it.each([
    { version: 2 }, { secretField: "DO_NOT_ECHO_SECRET" }, { hypotheses: [hypothesisFixture(), hypothesisFixture()] },
    { hypotheses: Array.from({ length: 201 }, (_, i) => hypothesisFixture({ externalId: `H-${String(i).padStart(3, "0")}` })) },
    { sessionId: "../../foreign" },
  ])("rejects invalid document %j", extra => { expect(hypothesesDocumentSchema.safeParse({ ...hypothesesFixture(), ...extra }).success).toBe(false); });
  it.each([
    { status: "LIKELY" }, { title: "x".repeat(201) }, { hypothesis: "x".repeat(4001) },
    { nextTest: "x".repeat(4001) }, { expectedSignal: "x".repeat(2001) }, { falsificationCondition: "x".repeat(2001) },
    { falsificationCondition: undefined }, { evidenceFor: Array(51).fill({ ref: "evidence/a.txt", summary: "Observation" }) },
    { evidenceAgainst: Array(51).fill({ ref: "evidence/a.txt", summary: "Observation" }) },
    { tags: ["<script>"] }, { tags: Array(21).fill("test") }, { externalId: "../H-001" },
    { confidence: "CRITICAL" }, { unknown: "DO_NOT_ECHO_SECRET" }, { evidenceFor: [] },
    { evidenceFor: [{ ref: "evidence/a.txt", summary: "text", extra: "unknown" }] },
    { updatedAt: "yesterday" }, { hypothesis: "   " },
  ])("rejects invalid hypothesis fields %j", extra => { expect(hypothesisSchema.safeParse({ ...hypothesisFixture(), ...extra }).success).toBe(false); });
  it("requires explicit blocked/rejected explanations", () => {
    expect(hypothesisSchema.safeParse(hypothesisFixture({ status: "BLOCKED" })).success).toBe(false);
    expect(hypothesisSchema.safeParse(hypothesisFixture({ status: "BLOCKED", blockedReason: "Second test account unavailable" })).success).toBe(true);
    expect(hypothesisSchema.safeParse(hypothesisFixture({ status: "REJECTED" })).success).toBe(false);
    expect(hypothesisSchema.safeParse(hypothesisFixture({ status: "REJECTED", notes: "Independent controls disproved shared object access" })).success).toBe(true);
    expect(hypothesisSchema.safeParse(hypothesisFixture({ status: "CONFIRMED", evidenceFor: [] })).success).toBe(false);
  });
  it("reports only known field paths and safe diagnostics without echoing unknown keys or values", () => {
    const invalid = hypothesesDocumentSchema.safeParse({ ...hypothesesFixture(), "SECRET_UNKNOWN_KEY": "private-token" });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      const errors = JSON.stringify(safeHypothesisIssues(invalid.error));
      expect(errors).toContain("Unknown fields"); expect(errors).not.toMatch(/SECRET_UNKNOWN_KEY|private-token/);
    }
  });
  it("normalizes tags and redacts recognizable credential assignments before snapshots/revisions", () => {
    const snapshot = hypothesisSnapshot(hypothesisFixture({ tags: ["z", "a", "a"], notes: "Cookie: fixture-cookie\nAuthorization: Bearer fixture-bearer\npassword=fixture-password\napiKey=sk-fixture-secret", evidenceFor: [{ ref: "evidence/a.txt", summary: "token=fixture-token" }] }));
    expect(snapshot.tags).toEqual(["a", "z"]);
    expect(JSON.stringify(snapshot)).not.toMatch(/fixture-(cookie|bearer|password|secret|token)/);
  });
  it("sorts by explicit status order, numeric externalId and creation date", () => {
    const rows = [{ externalId: "H-010", status: "OPEN" as const, createdAt: new Date(0) }, { externalId: "H-001", status: "REJECTED" as const, createdAt: new Date(0) }, { externalId: "H-002", status: "OPEN" as const, createdAt: new Date(0) }];
    expect(sortHypotheses(rows).map(h => h.externalId)).toEqual(["H-002", "H-010", "H-001"]);
  });
});
describe("relative evidence references", () => {
  it.each(["../../etc/passwd", "/etc/passwd", "file:///etc/passwd", "http://example.test/foo", "https://example.test/foo", "evidence/../scope.md", "evidence/%2e%2e/file", "evidence/%252e%252e/file", "evidence\\file", "evidence//file", ".exports/private.zip", "evidence/.env", "evidence/test.txt#fragment#extra"])("rejects %s", ref => { expect(isEvidenceRef(ref)).toBe(false); });
  it.each(["recon/endpoints.json#endpoint-12", "findings/existing-findings.json#finding-abc", "evidence/test.txt", "scope.md", "evidence/request.txt#/request/0"])("accepts %s", ref => { expect(isEvidenceRef(ref)).toBe(true); });
});
