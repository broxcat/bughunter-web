// vulnClass -> suggested CWE. A suggestion only: it pre-fills Finding.cwe at
// creation and the user can always change it.

// Keys are normalized (lowercase, non-alphanumerics collapsed to a space).
const CWE_BY_CLASS: Record<string, string> = {
  xss: "CWE-79",
  "cross site scripting": "CWE-79",
  ssrf: "CWE-918",
  "server side request forgery": "CWE-918",
  idor: "CWE-639",
  bola: "CWE-639",
  "idor bola": "CWE-639",
  "insecure direct object reference": "CWE-639",
  "broken object level authorization": "CWE-639",
  csrf: "CWE-352",
  "cross site request forgery": "CWE-352",
  sqli: "CWE-89",
  "sql injection": "CWE-89",
  "command injection": "CWE-78",
  "os command injection": "CWE-78",
  rce: "CWE-78",
  ssti: "CWE-1336",
  "template injection": "CWE-1336",
  "server side template injection": "CWE-1336",
  xxe: "CWE-611",
  lfi: "CWE-22",
  "local file inclusion": "CWE-22",
  "path traversal": "CWE-22",
  "directory traversal": "CWE-22",
  "file inclusion": "CWE-98",
  rfi: "CWE-98",
  "insecure deserialization": "CWE-502",
  deserialization: "CWE-502",
  "jwt weakness": "CWE-347",
  jwt: "CWE-347",
  "oauth misconfig": "CWE-287",
  "oauth misconfiguration": "CWE-287",
  oauth: "CWE-287",
  // Scanner class for 401/403 -> 200 flips on protected resources.
  "broken access control": "CWE-284",
};

function normalize(vulnClass: string): string {
  return vulnClass
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Suggested CWE id (e.g. "CWE-79") for a vulnerability class, or null. */
export function suggestCwe(vulnClass?: string | null): string | null {
  if (!vulnClass) return null;
  return CWE_BY_CLASS[normalize(vulnClass)] ?? null;
}

export const CWE_PATTERN = /^CWE-\d{1,5}$/;

/** MITRE definition URL for a "CWE-<n>" id, or null if it is not well-formed. */
export function cweUrl(cwe?: string | null): string | null {
  if (!cwe || !CWE_PATTERN.test(cwe)) return null;
  return `https://cwe.mitre.org/data/definitions/${cwe.slice(4)}.html`;
}
