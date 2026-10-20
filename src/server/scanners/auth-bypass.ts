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

import { probe, type ProbeResult } from "./http";
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

export interface BypassVerdict {
  confidence: "PROVEN" | "CANDIDATE";
  reason: string;
}

const norm = (body: string): string => body.replace(/\s+/g, "");
const titleOf = (body: string): string | null => {
  const m = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().toLowerCase() : null;
};
const contentType = (p: ProbeResult): string =>
  (p.headers["content-type"] ?? "").toLowerCase();
// Markers that a JSON body is an error/empty shell rather than real resource data.
const JSON_ERROR_RE =
  /"(error|errors|message|detail|code)"\s*:|not\s*found|forbidden|unauthoriz|access denied/i;

/**
 * Decide whether a bypass technique's 401/403 -> 200 flip is a REAL bypass or a
 * false positive where the server simply served its default catch-all page.
 *
 * `target` is the response for the real path under the bypass technique; `catchAll`
 * is the response for a definitely-nonexistent path under the SAME technique (the
 * server's default/catch-all fingerprint). PROVEN only when the target response is
 * clearly distinct from the catch-all AND consistent with the targeted resource;
 * otherwise CANDIDATE with the reason. Pure + total (never throws).
 */
export function classifyBypassResponse(
  path: string,
  target: ProbeResult,
  catchAll: ProbeResult,
): BypassVerdict {
  const tct = contentType(target);
  const bothHtml = /text\/html/.test(tct) && /text\/html/.test(contentType(catchAll));
  const tTitle = titleOf(target.body);
  const cTitle = titleOf(catchAll.body);

  // (a) The 200 looks like the server's default catch-all page, not the resource.
  if (catchAll.status >= 200 && catchAll.status < 400) {
    const identical =
      norm(catchAll.body).length > 0 && norm(target.body) === norm(catchAll.body);
    const sameTitle = tTitle !== null && tTitle === cTitle;
    const sizeClose =
      catchAll.bodyLen > 0 &&
      Math.abs(target.bodyLen - catchAll.bodyLen) <=
        Math.max(64, catchAll.bodyLen * 0.15);
    if (identical || sameTitle || (bothHtml && sizeClose)) {
      return {
        confidence: "CANDIDATE",
        reason:
          `status flip observed but the response matches the server's default catch-all page ` +
          `(content-type ${tct || "?"}, ~${target.bodyLen} bytes` +
          `${sameTitle ? `, same <title> "${tTitle}"` : ""}) — not the targeted resource ${path}, ` +
          `likely false positive, verify manually`,
      };
    }
  }

  // (b) Distinct from the catch-all AND consistent with the targeted resource:
  //     a real JSON body (typical for an API path) with no error markers.
  const isJson = /application\/json|\+json/.test(tct);
  if (isJson && !looksEmpty(target.body) && !JSON_ERROR_RE.test(target.body.slice(0, 500))) {
    return {
      confidence: "PROVEN",
      reason:
        `response is JSON (${tct}) distinct from the catch-all page and consistent with the ` +
        `targeted resource — the access control is genuinely bypassed`,
    };
  }

  // (c) Ambiguous: differs from the catch-all but not confirmable as the resource.
  return {
    confidence: "CANDIDATE",
    reason: isJson
      ? `status flip to JSON (${tct}) but the body is empty or an error shell — not confirmed as the targeted resource, verify manually`
      : `status flip to ${tct || "an unknown content-type"}; response differs from the catch-all page but could not be confirmed as the targeted resource — verify manually`,
  };
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
          confidence: "CANDIDATE",
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

    // Check 2: 403/401 bypass. A status flip to 200 is NOT proof on its own — a
    // server may serve its default catch-all page (e.g. the HTML homepage) for the
    // bypassed request. For each flip we capture the same technique against a
    // definitely-nonexistent path (the catch-all fingerprint) and only confirm
    // PROVEN when the real response is distinct from it AND looks like the target
    // resource. We prefer a confirmed bypass; otherwise record the flip as an
    // unconfirmed CANDIDATE with the reason (never a silent false positive).
    if (base.status === 401 || base.status === 403) {
      const evidenceOf = (attempt: { label: string; url: string; method: string; headers?: Record<string, string> }, r: ProbeResult) =>
        `Baseline: GET ${path} → ${base.status}\n` +
        `Bypass: ${attempt.method} ${attempt.url}` +
        `${attempt.headers ? ` with ${JSON.stringify(attempt.headers)}` : ""} → 200 ` +
        `(content-type: ${r.headers["content-type"] ?? "?"}, ${r.bodyLen} bytes)`;

      let candidate:
        | { attempt: ReturnType<typeof bypassAttempts>[number]; r: ProbeResult; verdict: BypassVerdict }
        | null = null;

      for (const attempt of bypassAttempts(ctx.baseUrl, path)) {
        const r = await probe(attempt.url, {
          method: attempt.method,
          headers: attempt.headers,
          timeoutMs: 10_000,
        });
        if (r.status !== 200 || looksEmpty(r.body)) continue;

        // Capture the catch-all fingerprint for THIS technique (same headers/shape,
        // a bogus path) and classify. Any failure degrades to CANDIDATE — never throw.
        let verdict: BypassVerdict;
        const bogusPath = `/zz-nonexistent-${Math.random().toString(36).slice(2, 10)}`;
        const refAttempt = bypassAttempts(ctx.baseUrl, bogusPath).find(
          (a) => a.label === attempt.label,
        );
        if (!refAttempt) {
          verdict = {
            confidence: "CANDIDATE",
            reason: "could not build a catch-all reference for this technique — not confirming bypass",
          };
        } else {
          const ref = await probe(refAttempt.url, {
            method: refAttempt.method,
            headers: refAttempt.headers,
            timeoutMs: 10_000,
          });
          verdict = ref.error
            ? {
                confidence: "CANDIDATE",
                reason: `could not capture a catch-all reference (${ref.error}) — not confirming bypass, verify manually`,
              }
            : classifyBypassResponse(path, r, ref);
        }

        if (verdict.confidence === "PROVEN") {
          await recordFinding(ctx, {
            title: `403/401 bypass on ${path} via ${attempt.label}`,
            vulnClass: "Broken Access Control",
            severity: "HIGH",
            confidence: "PROVEN",
            location: `${ctx.baseUrl}${path}`,
            description:
              `${path} returns ${base.status} normally but 200 when using the ` +
              `"${attempt.label}" technique. ${verdict.reason}`,
            evidence: evidenceOf(attempt, r),
          });
          await logLine(ctx.scanRunId, `[auth-bypass] BYPASS (confirmed) ${path} via ${attempt.label}`);
          candidate = null;
          break; // confirmed — stop at the first real bypass
        }
        if (!candidate) candidate = { attempt, r, verdict }; // keep first; keep looking for a PROVEN
      }

      // No confirmed bypass, but a flip happened: record it honestly as unconfirmed.
      if (candidate) {
        await recordFinding(ctx, {
          title: `Possible 403/401 bypass on ${path} via ${candidate.attempt.label} (unconfirmed)`,
          vulnClass: "Broken Access Control",
          severity: "MEDIUM",
          confidence: "CANDIDATE",
          location: `${ctx.baseUrl}${path}`,
          description:
            `${path} returns ${base.status} normally but 200 when using the ` +
            `"${candidate.attempt.label}" technique. ${candidate.verdict.reason}`,
          evidence: evidenceOf(candidate.attempt, candidate.r),
        });
        await logLine(
          ctx.scanRunId,
          `[auth-bypass] possible (unconfirmed) bypass ${path} via ${candidate.attempt.label}: ${candidate.verdict.reason}`,
        );
      }
    }
  }

  await logLine(ctx.scanRunId, "[auth-bypass] done");
}
