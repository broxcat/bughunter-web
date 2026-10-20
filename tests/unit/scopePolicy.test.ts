import { describe, it, expect } from "vitest";
import {
  POLICY_SECTIONS,
  POLICY_TEXT_FIELDS,
  nullIfBlank,
  updatePolicySchema,
} from "@/lib/scopePolicy";

describe("scope policy schema", () => {
  it("has a labelled section for every text field, and no extras", () => {
    expect(POLICY_SECTIONS.map((s) => s.field).sort()).toEqual(
      [...POLICY_TEXT_FIELDS].sort(),
    );
  });

  it("accepts YESWEHACK as a platform", () => {
    expect(updatePolicySchema.safeParse({ platform: "YESWEHACK" }).success).toBe(true);
    expect(updatePolicySchema.safeParse({ platform: "NOPE" }).success).toBe(false);
  });

  it("never lets the edit endpoint carry authorization fields", () => {
    const parsed = updatePolicySchema.parse({
      status: "APPROVED",
      hostPattern: "*.evil.example",
      justification: "changed",
      outOfScope: "staging.*",
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("hostPattern");
    expect(parsed).not.toHaveProperty("justification");
    expect(parsed.outOfScope).toBe("staging.*");
  });

  it("stores blank text as null so cleared fields are cleared", () => {
    expect(nullIfBlank("")).toBeNull();
    expect(nullIfBlank("x")).toBe("x");
    expect(nullIfBlank(undefined)).toBeUndefined();
  });
});
