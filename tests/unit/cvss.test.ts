import { describe, it, expect } from "vitest";
import {
  buildVector,
  calculateBaseScore,
  cvssRating,
  parseVector,
  roundUp,
  scoreVector,
} from "@/lib/cvss";
import { cweUrl, suggestCwe } from "@/lib/cwe";

// Reference scores from the FIRST.org CVSS v3.1 calculator.
const VECTORS: [string, number][] = [
  ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8],
  ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", 10.0],
  ["CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H", 9.9],
  ["CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N", 6.1],
  ["CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:H/A:N", 6.5],
  ["CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N", 6.5],
  ["CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", 7.8],
  ["CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N", 1.6],
  ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N", 0.0],
];

describe("CVSS 3.1 base score", () => {
  it.each(VECTORS)("%s -> %s", (vector, expected) => {
    expect(scoreVector(vector)?.score).toBe(expected);
  });

  it("rounds up per the spec without floating point artifacts", () => {
    expect(roundUp(4.0)).toBe(4.0);
    expect(roundUp(4.000000000000001)).toBe(4.0);
    expect(roundUp(4.02)).toBe(4.1);
    expect(roundUp(0.1)).toBe(0.1);
  });

  it("maps scores to the qualitative rating scale", () => {
    expect(cvssRating(0)).toBe("None");
    expect(cvssRating(0.1)).toBe("Low");
    expect(cvssRating(3.9)).toBe("Low");
    expect(cvssRating(4.0)).toBe("Medium");
    expect(cvssRating(6.9)).toBe("Medium");
    expect(cvssRating(7.0)).toBe("High");
    expect(cvssRating(8.9)).toBe("High");
    expect(cvssRating(9.0)).toBe("Critical");
    expect(cvssRating(10)).toBe("Critical");
  });

  it("round-trips metrics through the vector string", () => {
    const m = parseVector(VECTORS[3][0])!;
    expect(buildVector(m)).toBe(VECTORS[3][0]);
    expect(calculateBaseScore(m)).toBe(6.1);
  });

  it("rejects malformed vectors", () => {
    for (const bad of [
      "",
      "CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H",
      "CVSS:3.1/AC:L/AV:N/PR:N/UI:N/S:U/C:H/I:H/A:H",
      "CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:F",
      "CVSS:3.1/AV:N:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    ]) {
      expect(scoreVector(bad)).toBeNull();
    }
  });
});

describe("CWE suggestions", () => {
  it.each([
    ["XSS", "CWE-79"],
    ["SSRF", "CWE-918"],
    ["IDOR", "CWE-639"],
    ["IDOR/BOLA", "CWE-639"],
    ["CSRF", "CWE-352"],
    ["SQLi", "CWE-89"],
    ["Command Injection", "CWE-78"],
    ["SSTI", "CWE-1336"],
    ["XXE", "CWE-611"],
    ["LFI", "CWE-22"],
    ["Insecure Deserialization", "CWE-502"],
    ["JWT weakness", "CWE-347"],
    ["OAuth misconfig", "CWE-287"],
    ["Broken Access Control", "CWE-284"],
  ])("%s -> %s", (cls, cwe) => {
    expect(suggestCwe(cls)).toBe(cwe);
  });

  it("returns null for unknown or missing classes", () => {
    expect(suggestCwe("Something new")).toBeNull();
    expect(suggestCwe(undefined)).toBeNull();
  });

  it("builds a MITRE URL only for well-formed ids", () => {
    expect(cweUrl("CWE-79")).toBe("https://cwe.mitre.org/data/definitions/79.html");
    expect(cweUrl("CWE-")).toBeNull();
    expect(cweUrl("79")).toBeNull();
    expect(cweUrl(null)).toBeNull();
  });
});
