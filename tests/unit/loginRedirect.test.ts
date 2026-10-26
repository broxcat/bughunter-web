import { describe, expect, it } from "vitest";
import { safeLoginRedirect } from "@/lib/loginRedirect";
describe("post-login destinations", () => {
  it("preserves relative private paths and query parameters", () => { for(const value of ["/targets", "/scopes?program=test", "/hunt/run"]) expect(safeLoginRedirect(value)).toBe(value); });
  it("rejects external schemes, protocol-relative URLs, backslashes and controls", () => { for(const value of [null,"","https://outside.invalid/","//outside.invalid/","/\\outside.invalid/","javascript:alert(1)","/\n/outside.invalid/"," /targets"]) expect(safeLoginRedirect(value)).toBe("/targets"); });
});
