// BOLA / IDOR scanner (web2-vuln-classes SKILL §1) — the AUTHENTICATED variant.
//
// Unlike idor.ts (which only surfaces id-like endpoints as INFO candidates
// because it has no sessions), this scanner has TWO real target credentials and
// can therefore PROVE Broken Object Level Authorization: account B reading
// account A's private object. That proof is the whole reason the IDOR SKILL
// says confirmation "needs two sessions".
//
// Method (per candidate object URL that A can see):
//   1. A fetches the object (we already confirmed A → 200 non-trivial).
//   2. B fetches the SAME URL with B's credentials.
//   3. An anonymous (no-cred) fetch is taken as a baseline / catch-all
//      fingerprint, and we reuse auth-bypass's classifyBypassResponse to reject
//      the case where B's 200 is just the server's public default page.
//   PROVEN only when B gets 200, B's body is substantively A's object (high
//   overlap, non-trivial, not an error/empty shell) AND it is distinct from the
//   anonymous baseline (not a public catch-all). Otherwise we degrade to a
//   CANDIDATE with an explicit reason, or record nothing — never inflate.
//
// Invariants: credential cookie/token VALUES are NEVER logged or put in a
// finding — only the human-readable credential LABELS. Every probe has a
// timeout. This function NEVER throws: any failure (no creds, network error,
// discovery failure) degrades to a skip or a CANDIDATE with a logged reason.
// Findings stay UNVALIDATED (recordFinding); they never pass the gate here.

import { probe, type ProbeResult } from "./http";
import { logLine, recordFinding, type ScanContext } from "./context";
import { classifyBypassResponse } from "./auth-bypass";
import {
  loadTargetCredentials,
  credentialHeaders,
  type DecryptedTargetCredential,
} from "@/server/credentials";

// Hard cap on the number of A-visible object endpoints we cross-test as B.
const MAX_BOLA_PAIRS = 8;
// How many id-bearing URLs we consider before A-confirmation (bounds request
// volume while leaving headroom to fill the cap after filtering).
const MAX_DISCOVERY = 24;
const PROBE_TIMEOUT = 10_000;
// Body-overlap thresholds: >= PROVEN_SIM means B saw the same object as A;
// the ambiguous band [AMBIG_SIM, PROVEN_SIM) is a CANDIDATE, not a proof.
const PROVEN_SIM = 0.8;
const AMBIG_SIM = 0.4;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Query keys that commonly carry a direct object reference.
const ID_PARAM_RE =
  /(^|_)(id|uid|user|account|order|invoice|doc|document|report|file|ticket|msg|message)s?(_?id)?$/i;
// A numeric id as a path segment, e.g. /users/123 or /orders/123/items.
const NUMERIC_PATH_RE = /\/\d{1,}(?:\/|$)/;

// Common id-bearing object patterns, used only to top up discovery when the
// root page does not link enough. id "1" is the canonical "first object".
const COMMON_PATTERNS = [
  "/api/users/1",
  "/api/user/1",
  "/api/accounts/1",
  "/api/orders/1",
  "/api/invoices/1",
  "/api/documents/1",
  "/users/1",
  "/orders/1",
];

const norm = (body: string): string => body.replace(/\s+/g, "");

function looksEmpty(body: string): boolean {
  return norm(body).length < 32;
}

// A JSON error / "forbidden" shell rather than real resource data.
const ERROR_SHELL_RE =
  /"(error|errors|message|detail|code)"\s*:|not\s*found|forbidden|unauthoriz|access denied|permission/i;

function looksLikeError(p: ProbeResult): boolean {
  return ERROR_SHELL_RE.test(p.body.slice(0, 500));
}

function contentType(p: ProbeResult): string {
  return (p.headers["content-type"] ?? "").toLowerCase();
}

/** Same-origin absolute URLs referenced by an HTML/JSON body. */
function extractUrls(body: string, baseUrl: string, host: string): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    try {
      const abs = new URL(raw, baseUrl);
      if (abs.host === host && /^https?:$/.test(abs.protocol)) {
        out.add(abs.toString());
      }
    } catch {
      /* ignore malformed */
    }
  };
  for (const m of body.matchAll(/(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) {
    add(m[1]);
  }
  for (const m of body.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    add(m[0]);
  }
  return [...out];
}

/** True when the URL carries a direct object reference we can cross-test. */
function hasObjectId(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  for (const key of parsed.searchParams.keys()) {
    if (ID_PARAM_RE.test(key)) return true;
  }
  return UUID_RE.test(url) || NUMERIC_PATH_RE.test(parsed.pathname);
}

/** pathname + search, for classifyBypassResponse's `path` argument + logging. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/**
 * Overlap between two response bodies in [0,1], via char-shingle Jaccard on the
 * whitespace-normalized text. 1 = identical; high values mean B saw the same
 * object A did. Robust to small per-request differences (timestamps, csrf tags).
 */
function similarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const K = 8;
  const shingle = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i + K <= s.length; i++) set.add(s.slice(i, i + K));
    return set;
  };
  const sa = shingle(na);
  const sb = shingle(nb);
  if (sa.size === 0 || sb.size === 0) return 0;
  const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  let inter = 0;
  for (const s of small) if (big.has(s)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Was the classifier's verdict specifically the "public catch-all" rejection? */
function flaggedCatchAll(verdict: { confidence: string; reason: string }): boolean {
  return verdict.confidence !== "PROVEN" && /catch-all/i.test(verdict.reason);
}

export async function runBola(ctx: ScanContext): Promise<void> {
  let creds: DecryptedTargetCredential[];
  try {
    creds = await loadTargetCredentials(ctx.targetId);
  } catch (err) {
    await logLine(
      ctx.scanRunId,
      `[bola] scan skipped: could not load target credentials (${err instanceof Error ? err.message : String(err)})`,
      "STDERR",
    );
    return;
  }

  if (creds.length < 2) {
    await logLine(
      ctx.scanRunId,
      `[bola] scan skipped: requires 2 target credentials, found ${creds.length}`,
    );
    return;
  }

  const a = creds[0];
  const b = creds[1];
  const headersA = credentialHeaders(a);
  const headersB = credentialHeaders(b);
  await logLine(
    ctx.scanRunId,
    `[bola] cross-account object access test on ${ctx.baseUrl} — account A="${a.label}" vs B="${b.label}"`,
  );

  const host = new URL(ctx.baseUrl).host;

  // 1) Discover candidate object URLs from A's view of the root page.
  const root = await probe(ctx.baseUrl, { headers: headersA, timeoutMs: PROBE_TIMEOUT });
  if (root.error) {
    await logLine(
      ctx.scanRunId,
      `[bola] could not fetch ${ctx.baseUrl} as A: ${root.error} — skipping`,
      "STDERR",
    );
    return;
  }

  const discovered: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    if (!seen.has(u) && hasObjectId(u)) {
      seen.add(u);
      discovered.push(u);
    }
  };
  for (const u of extractUrls(root.body, ctx.baseUrl, host)) {
    push(u);
    if (discovered.length >= MAX_DISCOVERY) break;
  }
  // Top up with common id-bearing patterns if the page linked few objects.
  for (const p of COMMON_PATTERNS) {
    if (discovered.length >= MAX_DISCOVERY) break;
    push(new URL(p, ctx.baseUrl).toString());
  }

  await logLine(
    ctx.scanRunId,
    `[bola] ${discovered.length} id-bearing candidate URL(s) to confirm as A`,
  );

  // 2) Keep only URLs A can actually read (200 + non-trivial, non-error body),
  //    capped at MAX_BOLA_PAIRS.
  const objects: Array<{ url: string; aResp: ProbeResult }> = [];
  for (const url of discovered) {
    if (objects.length >= MAX_BOLA_PAIRS) break;
    const aResp = await probe(url, { headers: headersA, timeoutMs: PROBE_TIMEOUT });
    if (aResp.error) continue;
    if (aResp.status === 200 && !looksEmpty(aResp.body) && !looksLikeError(aResp)) {
      objects.push({ url, aResp });
    }
  }

  if (objects.length === 0) {
    await logLine(
      ctx.scanRunId,
      "[bola] A could not read any id-bearing object on the root page — nothing to cross-test (run recon crawl for deeper coverage)",
    );
    return;
  }

  await logLine(
    ctx.scanRunId,
    `[bola] cross-testing ${objects.length} of A's objects as account B (cap ${MAX_BOLA_PAIRS})`,
  );

  // 3) For each of A's objects, try to read it as B.
  for (const { url, aResp } of objects) {
    const path = pathOf(url);
    const bResp = await probe(url, { headers: headersB, timeoutMs: PROBE_TIMEOUT });

    if (bResp.error) {
      await logLine(ctx.scanRunId, `[bola] ${path} → B error: ${bResp.error} — no finding`, "STDERR");
      continue;
    }

    // B is denied, or sees nothing / an error — expected, NOT a BOLA.
    if (bResp.status !== 200) {
      await logLine(
        ctx.scanRunId,
        `[bola] ${path} → B got ${bResp.status} (A got 200) — access control holds, no finding`,
      );
      continue;
    }
    if (looksEmpty(bResp.body) || looksLikeError(bResp)) {
      await logLine(
        ctx.scanRunId,
        `[bola] ${path} → B got 200 but an empty/error body — likely B's own empty view, no finding`,
      );
      continue;
    }

    // Anonymous baseline (no credentials) = the server's public/catch-all view.
    const noAuth = await probe(url, { timeoutMs: PROBE_TIMEOUT });
    const sim = similarity(aResp.body, bResp.body);
    const simPct = Math.round(sim * 100);

    // Reuse auth-bypass's classifier to reject a public default-page response.
    const verdict = noAuth.error
      ? { confidence: "CANDIDATE" as const, reason: `could not capture an anonymous baseline (${noAuth.error})` }
      : classifyBypassResponse(path, bResp, noAuth);
    const isCatchAll = flaggedCatchAll(verdict);

    // Is the object also readable anonymously? Then it is public, not a BOLA.
    const publicToAnon =
      !noAuth.error &&
      noAuth.status === 200 &&
      !looksEmpty(noAuth.body) &&
      similarity(aResp.body, noAuth.body) >= PROVEN_SIM;

    const sizes =
      `A: HTTP ${aResp.status}, ${aResp.bodyLen} bytes, ${contentType(aResp) || "?"}; ` +
      `B: HTTP ${bResp.status}, ${bResp.bodyLen} bytes, ${contentType(bResp) || "?"}; ` +
      `anon: HTTP ${noAuth.error ? `error` : noAuth.status}, ${noAuth.bodyLen} bytes. ` +
      `A/B body overlap ${simPct}%.`;

    if (publicToAnon) {
      await logLine(
        ctx.scanRunId,
        `[bola] ${path} → object is also readable anonymously (${simPct}% match) — public resource, not a BOLA`,
      );
      continue;
    }

    // PROVEN: B (a different account) reads substantively A's object, it is not
    // the public catch-all page, and an anonymous user cannot read it.
    if (sim >= PROVEN_SIM && !isCatchAll) {
      await recordFinding(ctx, {
        title: `BOLA: account "${b.label}" can read account "${a.label}"'s object`,
        vulnClass: "IDOR/BOLA",
        severity: "HIGH",
        confidence: "PROVEN",
        location: url,
        description:
          `Broken Object Level Authorization confirmed with two target accounts. ` +
          `Object ${path} belongs to account A ("${a.label}") — A reads it (HTTP 200). ` +
          `A DIFFERENT account B ("${b.label}") requested the same URL with its own ` +
          `credentials and received the same object back (body overlap ${simPct}%). ` +
          `An anonymous request did not return the object (` +
          `${noAuth.error ? "baseline failed" : `HTTP ${noAuth.status}`}), and the B ` +
          `response is distinct from the server's default page (${verdict.reason}), ` +
          `so this is not a public resource. B is reading A's private data across the ` +
          `authorization boundary.`,
        evidence: `${sizes}\nClassifier: ${verdict.confidence} — ${verdict.reason}`,
      });
      await logLine(
        ctx.scanRunId,
        `[bola] PROVEN ${path} — B="${b.label}" reads A="${a.label}"'s object (${simPct}% match)`,
      );
      continue;
    }

    // Ambiguous: B got a non-trivial 200 that partly matches A's object, or we
    // could not rule out a shared/public page. Record as CANDIDATE, not a proof.
    if (sim >= AMBIG_SIM || !isCatchAll) {
      const reason = isCatchAll
        ? `B's 200 resembles the server's default/catch-all page (${verdict.reason}) — likely not A's object`
        : sim >= AMBIG_SIM
          ? `B's body partially overlaps A's object (${simPct}%) but not enough to confirm it is the same private object vs a shared/templated page`
          : `B returned a non-trivial 200 that does not clearly match A's object (${simPct}% overlap) — may be B's own object`;
      await recordFinding(ctx, {
        title: `Possible BOLA on ${path} (account "${b.label}" vs "${a.label}", unconfirmed)`,
        vulnClass: "IDOR/BOLA",
        severity: "MEDIUM",
        confidence: "CANDIDATE",
        location: url,
        description:
          `Account B ("${b.label}") received HTTP 200 for ${path}, an object first seen ` +
          `under account A ("${a.label}"). ${reason}. Confirm manually: verify the ` +
          `returned object truly belongs to A (not a shared/public resource and not B's ` +
          `own object), e.g. by diffing an A-only field.`,
        evidence: `${sizes}\nClassifier: ${verdict.confidence} — ${verdict.reason}`,
      });
      await logLine(
        ctx.scanRunId,
        `[bola] candidate ${path} — ${reason}`,
      );
      continue;
    }

    await logLine(
      ctx.scanRunId,
      `[bola] ${path} → B's 200 is the public catch-all page (${simPct}% match to A) — no finding`,
    );
  }

  await logLine(ctx.scanRunId, "[bola] done");
}
