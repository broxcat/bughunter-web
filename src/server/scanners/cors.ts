// CORS misconfiguration scanner (web2-vuln-classes SKILL).
//
// Reflecting an arbitrary request Origin back in Access-Control-Allow-Origin is
// a FACTUAL HTTP-header test — no browser is needed to prove it, so a confirmed
// reflection is recorded as PROVEN directly. Severity, however, stays honest:
//
//   A) reflects our arbitrary origin  AND  Allow-Credentials: true
//        -> PROVEN / HIGH   (authenticated cross-origin data theft is possible)
//   B) reflects our arbitrary origin  but NO credentials
//        -> PROVEN / MEDIUM (data from non-cookie endpoints can still leak; the
//                            browser will read the response for any site)
//   C) Access-Control-Allow-Origin: *  (wildcard)
//        -> PROVEN / LOW    (browsers ignore `*`+credentials; informational);
//           bumped to MEDIUM only if the body looks like sensitive JSON data
//   otherwise (no ACAO, or a fixed whitelist that is NOT our origin)
//        -> nothing reflected, no finding.
//
// Consumes the shared authenticated crawl (discoverCorpus) for candidate URLs;
// GET only, capped, and never throws — any failure is a logged skip.

import type { ScanContext } from "./context";
import { logLine, recordFinding } from "./context";
import { probe } from "./http";
import { discoverCorpus } from "./discovery";

// The origin we ask the server to reflect. Deliberately a bogus external host:
// if it comes back in Access-Control-Allow-Origin, the server echoes ANY origin.
const ARBITRARY_ORIGIN = "https://evil-bughunter-test.example";

const MAX_ENDPOINTS = 20;

/** Heuristic: an endpoint worth a CORS probe (API-ish or the site root). */
function looksApiIsh(url: string): boolean {
  return /\/(api|v\d+|graphql|rest|rpc|oauth|auth|account|user)s?(\/|$|\?)/i.test(url);
}

/** Cheap "sensitive JSON" heuristic for the wildcard severity bump only. */
function looksSensitiveJson(body: string, contentType: string): boolean {
  if (!/application\/json|\+json/.test(contentType)) return false;
  // A JSON object with several fields — more likely real data than an error shell.
  const fields = (body.slice(0, 2000).match(/"[^"]+"\s*:/g) ?? []).length;
  return fields >= 4;
}

export async function runCors(ctx: ScanContext): Promise<void> {
  await logLine(ctx.scanRunId, `[cors] CORS reflection sweep on ${ctx.baseUrl}`);

  const corpus = await discoverCorpus(ctx);
  if (!corpus.html) {
    await logLine(ctx.scanRunId, `[cors] could not crawl ${ctx.baseUrl} — skipping`, "STDERR");
    return;
  }
  if (corpus.authenticated) {
    await logLine(ctx.scanRunId, `[cors] using authenticated crawl (${corpus.urls.length} URLs)`);
  }

  // Prefer API-ish endpoints; fall back to any same-origin URL if few match.
  // Always include the site root so a root-level CORS policy is tested.
  const apiIsh = corpus.urls.filter(looksApiIsh);
  const pool = apiIsh.length >= 3 ? apiIsh : corpus.urls;
  const endpoints = [...new Set([ctx.baseUrl, ...pool])].slice(0, MAX_ENDPOINTS);

  let findings = 0;
  for (const url of endpoints) {
    const res = await probe(url, {
      headers: { Origin: ARBITRARY_ORIGIN },
      timeoutMs: 10_000,
    });
    if (res.error) continue;

    const acao = res.headers["access-control-allow-origin"];
    if (!acao) continue; // no CORS at all — nothing to flag
    const acac = (res.headers["access-control-allow-credentials"] ?? "").toLowerCase() === "true";
    const contentType = (res.headers["content-type"] ?? "").toLowerCase();

    const evidence =
      `Request: GET ${url}\n` +
      `  Origin: ${ARBITRARY_ORIGIN}\n` +
      `Response: HTTP ${res.status}\n` +
      `  Access-Control-Allow-Origin: ${acao}\n` +
      `  Access-Control-Allow-Credentials: ${res.headers["access-control-allow-credentials"] ?? "(absent)"}`;

    // Case A/B: the server reflected OUR arbitrary origin verbatim.
    if (acao === ARBITRARY_ORIGIN) {
      if (acac) {
        await recordFinding(ctx, {
          title: `CORS reflects arbitrary origin with credentials: ${url}`,
          vulnClass: "CORS Misconfiguration",
          severity: "HIGH",
          confidence: "PROVEN",
          location: url,
          description:
            `The endpoint reflects an attacker-controlled Origin (${ARBITRARY_ORIGIN}) in ` +
            `Access-Control-Allow-Origin AND sets Access-Control-Allow-Credentials: true. ` +
            `Any malicious site a victim visits can issue credentialed cross-origin requests ` +
            `to this endpoint and read the authenticated response — enabling theft of the ` +
            `victim's private data / CSRF-token exfiltration. Proven by direct header ` +
            `inspection; confirm the stolen response contains sensitive data.`,
          evidence,
        });
        findings++;
        await logLine(ctx.scanRunId, `[cors] PROVEN credentialed reflection @ ${url}`);
      } else {
        await recordFinding(ctx, {
          title: `CORS reflects arbitrary origin (no credentials): ${url}`,
          vulnClass: "CORS Misconfiguration",
          severity: "MEDIUM",
          confidence: "PROVEN",
          location: url,
          description:
            `The endpoint reflects an attacker-controlled Origin (${ARBITRARY_ORIGIN}) in ` +
            `Access-Control-Allow-Origin but does NOT set Access-Control-Allow-Credentials. ` +
            `Impact is lower than the credentialed case (no cookie-authenticated data is ` +
            `exposed), but any site can still read this endpoint's response cross-origin — ` +
            `a leak for any data served without cookies (API keys in URLs, tokens, PII in ` +
            `an unauthenticated-but-private response). Proven by direct header inspection.`,
          evidence,
        });
        findings++;
        await logLine(ctx.scanRunId, `[cors] PROVEN reflection (no creds) @ ${url}`);
      }
      continue;
    }

    // Case C: wildcard. Low by default; browsers ignore `*` + credentials.
    if (acao === "*") {
      const sensitive = looksSensitiveJson(res.body, contentType);
      await recordFinding(ctx, {
        title: `CORS wildcard Access-Control-Allow-Origin: ${url}`,
        vulnClass: "CORS Misconfiguration",
        severity: sensitive ? "MEDIUM" : "LOW",
        confidence: "PROVEN",
        location: url,
        description:
          `The endpoint returns Access-Control-Allow-Origin: * . A wildcard lets any origin ` +
          `read the response, but browsers refuse to send credentials to a wildcard ACAO, so ` +
          `cookie-authenticated data is not directly exposed this way. ` +
          (sensitive
            ? `The response looks like sensitive JSON data, so any site can read it cross-origin — review what it exposes.`
            : `Informational-to-low unless the endpoint serves data that should not be world-readable.`) +
          ` Proven by direct header inspection.`,
        evidence,
      });
      findings++;
      await logLine(ctx.scanRunId, `[cors] wildcard ACAO @ ${url}`);
      continue;
    }

    // Otherwise: a fixed value that is not our origin -> strict whitelist, no finding.
  }

  await logLine(
    ctx.scanRunId,
    `[cors] done — ${endpoints.length} endpoint(s) tested, ${findings} finding(s)`,
  );
}
