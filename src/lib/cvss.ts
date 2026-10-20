// CVSS v3.1 Base Score calculator, implemented from the FIRST.org specification
// (https://www.first.org/cvss/v3.1/specification-document, section 7 + Appendix A
// Roundup). Base metrics only; Temporal and Environmental are out of scope.
//
// Pure and dependency-free so it runs identically in the browser (live calculator)
// and on the server (which recomputes the score from the vector and never trusts a
// client-supplied number).

export type MetricKey = "AV" | "AC" | "PR" | "UI" | "S" | "C" | "I" | "A";

export interface MetricOption {
  value: string;
  label: string;
}

export interface MetricDef {
  key: MetricKey;
  name: string;
  options: MetricOption[];
}

/** The eight base metrics with their exact option sets, in vector order. */
export const CVSS_METRICS: MetricDef[] = [
  {
    key: "AV",
    name: "Attack Vector",
    options: [
      { value: "N", label: "Network" },
      { value: "A", label: "Adjacent" },
      { value: "L", label: "Local" },
      { value: "P", label: "Physical" },
    ],
  },
  {
    key: "AC",
    name: "Attack Complexity",
    options: [
      { value: "L", label: "Low" },
      { value: "H", label: "High" },
    ],
  },
  {
    key: "PR",
    name: "Privileges Required",
    options: [
      { value: "N", label: "None" },
      { value: "L", label: "Low" },
      { value: "H", label: "High" },
    ],
  },
  {
    key: "UI",
    name: "User Interaction",
    options: [
      { value: "N", label: "None" },
      { value: "R", label: "Required" },
    ],
  },
  {
    key: "S",
    name: "Scope",
    options: [
      { value: "U", label: "Unchanged" },
      { value: "C", label: "Changed" },
    ],
  },
  {
    key: "C",
    name: "Confidentiality",
    options: [
      { value: "N", label: "None" },
      { value: "L", label: "Low" },
      { value: "H", label: "High" },
    ],
  },
  {
    key: "I",
    name: "Integrity",
    options: [
      { value: "N", label: "None" },
      { value: "L", label: "Low" },
      { value: "H", label: "High" },
    ],
  },
  {
    key: "A",
    name: "Availability",
    options: [
      { value: "N", label: "None" },
      { value: "L", label: "Low" },
      { value: "H", label: "High" },
    ],
  },
];

export type CvssMetrics = Record<MetricKey, string>;

export type CvssRating = "None" | "Low" | "Medium" | "High" | "Critical";

const PREFIX = "CVSS:3.1";

const WEIGHT_AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const WEIGHT_AC: Record<string, number> = { L: 0.77, H: 0.44 };
const WEIGHT_UI: Record<string, number> = { N: 0.85, R: 0.62 };
const WEIGHT_CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

// Privileges Required depends on Scope.
function weightPR(pr: string, scopeChanged: boolean): number {
  if (pr === "N") return 0.85;
  if (pr === "L") return scopeChanged ? 0.68 : 0.62;
  return scopeChanged ? 0.5 : 0.27; // H
}

/**
 * Spec Appendix A "Roundup": smallest number, to one decimal place, that is
 * equal to or higher than the input — computed on integers to avoid binary
 * floating-point artifacts (e.g. 4.000000000000001 must not become 4.1).
 */
export function roundUp(input: number): number {
  const intInput = Math.round(input * 100000);
  if (intInput % 10000 === 0) return intInput / 100000;
  return (Math.floor(intInput / 10000) + 1) / 10;
}

/** Base score (0.0–10.0) for a complete set of base metrics. */
export function calculateBaseScore(m: CvssMetrics): number {
  const scopeChanged = m.S === "C";

  const iss =
    1 - (1 - WEIGHT_CIA[m.C]) * (1 - WEIGHT_CIA[m.I]) * (1 - WEIGHT_CIA[m.A]);

  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss;

  const exploitability =
    8.22 * WEIGHT_AV[m.AV] * WEIGHT_AC[m.AC] * weightPR(m.PR, scopeChanged) * WEIGHT_UI[m.UI];

  if (impact <= 0) return 0;

  return scopeChanged
    ? roundUp(Math.min(1.08 * (impact + exploitability), 10))
    : roundUp(Math.min(impact + exploitability, 10));
}

/** Qualitative severity rating scale (spec section 5). */
export function cvssRating(score: number): CvssRating {
  if (score === 0) return "None";
  if (score < 4) return "Low";
  if (score < 7) return "Medium";
  if (score < 9) return "High";
  return "Critical";
}

/** Serialize complete metrics to the canonical vector string. */
export function buildVector(m: CvssMetrics): string {
  return `${PREFIX}/${CVSS_METRICS.map((d) => `${d.key}:${m[d.key]}`).join("/")}`;
}

/**
 * Parse a CVSS:3.1 base vector. Strict: exact prefix, all eight metrics exactly
 * once, in order, each with a valid value. Returns null for anything else.
 */
export function parseVector(vector: string): CvssMetrics | null {
  const parts = vector.trim().split("/");
  if (parts.length !== CVSS_METRICS.length + 1 || parts[0] !== PREFIX) return null;

  const out: Partial<CvssMetrics> = {};
  for (let i = 0; i < CVSS_METRICS.length; i++) {
    const def = CVSS_METRICS[i];
    const [key, value, extra] = parts[i + 1].split(":");
    if (key !== def.key || extra !== undefined) return null;
    if (!def.options.some((o) => o.value === value)) return null;
    out[def.key] = value;
  }
  return out as CvssMetrics;
}

export interface CvssResult {
  vector: string;
  score: number;
  rating: CvssRating;
}

/** Validate a vector string and compute its score; null if the vector is invalid. */
export function scoreVector(vector: string): CvssResult | null {
  const metrics = parseVector(vector);
  if (!metrics) return null;
  const score = calculateBaseScore(metrics);
  return { vector: buildVector(metrics), score, rating: cvssRating(score) };
}
