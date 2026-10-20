// Shared validation for the optional classification / report-text fields on a
// Finding (CWE, CVSS v3.1 vector, impact, remediation). Used by POST and PATCH
// /api/findings. None of these fields has any bearing on gateStatus or severity.

import { z } from "zod";
import { CWE_PATTERN } from "@/lib/cwe";
import { scoreVector } from "@/lib/cvss";

export const cweField = z
  .string()
  .trim()
  .regex(CWE_PATTERN, 'CWE must look like "CWE-79"');

export const cvssVectorField = z
  .string()
  .trim()
  .refine((v) => scoreVector(v) !== null, {
    message: "Invalid CVSS v3.1 base vector",
  });

export const reportTextField = z.string().trim().max(20000, "Too long (max 20000 characters)");

/**
 * The score is derived from the vector here, on the server, so a stored
 * cvssScore can never disagree with its vector. A null vector clears both.
 */
export function cvssColumns(
  vector: string | null | undefined,
): { cvssVector: string | null; cvssScore: number | null } | undefined {
  if (vector === undefined) return undefined;
  if (vector === null) return { cvssVector: null, cvssScore: null };
  const r = scoreVector(vector);
  if (!r) throw new Error("Invalid CVSS vector"); // unreachable after validation
  return { cvssVector: r.vector, cvssScore: r.score };
}
