import { describe, it, expect } from "vitest";
import { isLikelyUserParam } from "@/server/scanners/paramFilter";

const HOST = "https://b550-gaming-x-v2.tailc6d37b.ts.net";

describe("isLikelyUserParam", () => {
  // The exact real-world false positives from the Phase-10 smoke test.
  it("excludes Next.js static-asset cache-buster params", () => {
    expect(
      isLikelyUserParam(`${HOST}/favicon.ico?favicon.2vob68tjqpejf.ico`, "favicon.2vob68tjqpejf.ico"),
    ).toBe(false);
    expect(
      isLikelyUserParam(`${HOST}/opengraph-image?bd72c42020dc575e`, "bd72c42020dc575e"),
    ).toBe(false);
  });

  it("excludes /_next/ and other static-asset paths regardless of key", () => {
    expect(isLikelyUserParam(`${HOST}/_next/static/chunks/abc.js?v=1`, "v")).toBe(false);
    expect(isLikelyUserParam(`${HOST}/robots.txt?x=1`, "x")).toBe(false);
    expect(isLikelyUserParam(`${HOST}/sitemap.xml?x=1`, "x")).toBe(false);
  });

  it("excludes keyless query tokens (present key, empty value)", () => {
    expect(isLikelyUserParam(`${HOST}/page?deadbeefcafe1234`, "deadbeefcafe1234")).toBe(false);
  });

  it("excludes bare content-hash keys and filename-looking keys", () => {
    expect(isLikelyUserParam(`${HOST}/x?a1b2c3d4e5=1`, "a1b2c3d4e5")).toBe(false);
    expect(isLikelyUserParam(`${HOST}/x?style.css=1`, "style.css")).toBe(false);
  });

  // Genuine application parameters must pass.
  it("keeps real application parameters", () => {
    expect(isLikelyUserParam(`${HOST}/courses?courseId=42`, "courseId")).toBe(true);
    expect(isLikelyUserParam(`${HOST}/profile?userId=7`, "userId")).toBe(true);
    expect(isLikelyUserParam(`${HOST}/search?q=sql`, "q")).toBe(true);
    expect(isLikelyUserParam(`${HOST}/exams?id=3&view=full`, "view")).toBe(true);
  });

  it("returns false for an unparseable URL", () => {
    expect(isLikelyUserParam("not a url", "x")).toBe(false);
  });
});
