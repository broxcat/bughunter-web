// Broken Auth / Access Control scanner (web2-vuln-classes SKILL §2) + the
// 403/401 bypass matrix.
//
// Two checks, both automatable without loaded credentials:
//   1. Sibling-rule / missing-auth: hit sensitive paths anonymously. A 200 where
//      an auth challenge was expected is a candidate "missing auth" finding.
//   2. 403/401 bypass: for paths that DO challenge, try header/path/method
//      tricks; if one turns a 401/403 into a 200, that's a confirmed bypass.
//
// Optional brain triage reduces false positives on the missing-auth 200s (is the
// body actually sensitive, or just a generic page?). If no AI provider is
// configured, candidates are still recorded, flagged as un-triaged.

import { probe } from "./http";
import { logLine, recordFinding, type ScanContext } from "./context";
import { resolveActiveBrain } from "@/server/brain";
import type { BrainClient } from "@/server/brain";

// Common sensitive / sibling endpoints. Kept modest to bound request volume.
const SENSITIVE_PATHS = [
  "/admin",
  "/admin/users",
  "/admin/export",
  "/admin/delete",
  "/admin/reset",
  "/api/admin",
  "/api/admin/users",
  "/api/admin/export",
  "/api/users",
  "/api/internal",
  "/actuator",
  "/actuator/env",
  "/metrics",
  "/debug",
  "/.git/config",
];

// Bypass techniques (SKILL §2 + the CLI bypass_403 matrix). Each returns the
// request shape to try against a path that challenged with 401/403.
function bypassAttempts(
  baseUrl: string,
  path: string,
): Array<{ label: string; url: string; method: string; headers?: Record<string, string> }> {
  const u = `${baseUrl}${path}`;
  return [
    { label: "X-Original-URL header", url: baseUrl, method: "GET", headers: { "X-Original-URL": path } },
    { label: "X-Rewrite-URL header", url: baseUrl, method: "GET", headers: { "X-Rewrite-URL": path } },
    { label: "X-Forwarded-For 127.0.0.1", url: u, method: "GET", headers: { "X-Forwarded-For": "127.0.0.1" } },
    { label: "X-Custom-IP-Authorization 127.0.0.1", url: u, method: "GET", headers: { "X-Custom-IP-Authorization": "127.0.0.1" } },
    { label: "X-Forwarded-Host localhost", url: u, method: "GET", headers: { "X-Forwarded-Host": "localhost" } },
    { label: "trailing slash", url: `${u}/`, method: "GET" },
    { label: "trailing /.", url: `${u}/.`, method: "GET" },
    { label: "path %2e segment", url: `${baseUrl}/%2e${path}`, method: "GET" },
    { label: "double slash prefix", url: `${baseUrl}//${path.replace(/^\//, "")}`, method: "GET" },
    { label: "matrix ..;/ suffix", url: `${u}..;/`, method: "GET" },
    { label: "method swap POST", url: u, method: "POST" },
    { label: "method swap HEAD", url: u, method: "HEAD" },
  ];
}

function looksEmpty(body: string): boolean {
  return body.replace(/\s+/g, "").length < 32;
}

async function triageSensitive(
  brain: BrainClient | null,
  url: string,
  body: string,
): Promise<boolean | null> {
  if (!brain) return null;
  try {
    const answer = await brain.chat(
      "You are a security triage assistant. Answer with exactly YES or NO.",
      `Does this HTTP 200 response from ${url} expose a genuinely sensitive or ` +
        `administrative surface (admin panel, user data, internal API, secrets, ` +
        `config)? Answer YES only if it is clearly sensitive. Response body ` +
        `(truncated):\n\n${body.slice(0, 2000)}`,
      { maxTokens: 5, temperature: 0 },
    );
    return /yes/i.test(answer);
  } catch {
    return null; // triage unavailable; treat as inconclusive
  }
}

export async function runAuthBypass(ctx: ScanContext): Promise<void> {
  await logLine(
    ctx.scanRunId,
    `[auth-bypass] Broken-auth / access-control sweep on ${ctx.baseUrl} (${SENSITIVE_PATHS.length} paths)`,
  );

  const brain = await resolveActiveBrain(ctx.userId).catch(() => null);
  if (!brain) {
    await logLine(
      ctx.scanRunId,
      "[auth-bypass] no active AI provider — missing-auth hits recorded without AI triage",
    );
  }

  for (const path of SENSITIVE_PATHS) {
    const base = await probe(`${ctx.baseUrl}${path}`, { timeoutMs: 10_000 });
    if (base.error) {
      await logLine(ctx.scanRunId, `[auth-bypass] ${path} → error: ${base.error}`, "STDERR");
      continue;
    }
    await logLine(ctx.scanRunId, `[auth-bypass] GET ${path} → ${base.status}`);

    // Check 1: missing auth — a 200 on a sensitive path.
    if (base.status === 200 && !looksEmpty(base.body)) {
      const sensitive = await triageSensitive(brain, `${ctx.baseUrl}${path}`, base.body);
      if (sensitive === false) {
        await logLine(ctx.scanRunId, `[auth-bypass] ${path} 200 but AI triage says not sensitive — skipped`);
      } else {
        const triageNote =
          sensitive === true
            ? "AI triage: response looks sensitive."
            : "AI triage unavailable — verify the response is genuinely sensitive.";
        await recordFinding(ctx, {
          title: `Sensitive endpoint reachable without authentication: ${path}`,
          vulnClass: "Broken Access Control",
          severity: "MEDIUM",
          location: `${ctx.baseUrl}${path}`,
          description:
            `GET ${path} returned 200 anonymously. Per the sibling rule, a sensitive ` +
            `endpoint reachable with no auth where its siblings are protected is a ` +
            `likely access-control gap. ${triageNote} Confirm: compare this path ` +
            `authenticated vs anonymous, and verify the data is privileged.`,
          evidence: `HTTP 200, ${base.bodyLen} bytes. First 200 bytes:\n${base.body.slice(0, 200)}`,
        });
      }
      continue;
    }

    // Check 2: 403/401 bypass — try the matrix, stop at the first that works.
    if (base.status === 401 || base.status === 403) {
      for (const attempt of bypassAttempts(ctx.baseUrl, path)) {
        const r = await probe(attempt.url, {
          method: attempt.method,
          headers: attempt.headers,
          timeoutMs: 10_000,
        });
        if (r.status === 200 && !looksEmpty(r.body)) {
          await recordFinding(ctx, {
            title: `403/401 bypass on ${path} via ${attempt.label}`,
            vulnClass: "Broken Access Control",
            severity: "HIGH",
            location: `${ctx.baseUrl}${path}`,
            description:
              `${path} returns ${base.status} normally but 200 when using the ` +
              `"${attempt.label}" technique — the access control can be bypassed.`,
            evidence:
              `Baseline: GET ${path} → ${base.status}\n` +
              `Bypass: ${attempt.method} ${attempt.url}` +
              `${attempt.headers ? ` with ${JSON.stringify(attempt.headers)}` : ""} → 200`,
          });
          await logLine(ctx.scanRunId, `[auth-bypass] BYPASS ${path} via ${attempt.label}`);
          break;
        }
      }
    }
  }

  await logLine(ctx.scanRunId, "[auth-bypass] done");
}
