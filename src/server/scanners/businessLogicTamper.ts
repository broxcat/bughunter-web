// Business-logic: critical-value tampering (web2-vuln-classes SKILL — business
// logic / mass-assignment-adjacent).
//
// INTRINSICALLY LOWER DETECTION RATE — BY DESIGN, NOT A BUG. Real business-logic
// flaws depend on domain knowledge a generic scanner does not have (what a price
// SHOULD be, which role unlocks what, whether a negative quantity means a refund).
// So this family deliberately confirms far less than the injection families, and
// that is expected and correct. We would rather emit nothing than a false "you
// can buy for $0" that wastes a triager's time.
//
// STRICTEST epistemic honesty in the whole port:
//   - A 200/201, an absence of error, or the tampered value merely ECHOED back in
//     the response PROVE NOTHING. Servers routinely reflect input they never act on.
//   - PROVEN (severity HIGH) requires a verified server-side EFFECT:
//       * a resource/function that returned 401/403 (or redirected to login) with
//         the original value becomes genuinely accessible (200, real non-error
//         body, distinct from the denied one) after a role/flag/level flip —
//         confirmed by the before/after pair we send here, not assumed; or
//       * (monetary) a server-side read-back shows the stored/charged value — not
//         available generically, so money tampering stays CANDIDATE here.
//   - Otherwise CANDIDATE (severity MEDIUM) with a precise reason stating what was
//     tampered, what came back, and why it is inconclusive.
//   - If candidate DETECTION itself was uncertain, we record nothing.
//
// SAFETY: never destructive. No DELETE, no delete/remove/purge/wipe paths, and we
// skip endpoints that look like they FINALIZE a real payment/order/charge (prefer
// cart/quote/coupon/claim surfaces). Only the targeted field is mutated; the rest
// of the request is sent unchanged. Low caps (≤ MAX_CANDIDATES), sequential — no
// high-volume bursts here. Consumes the shared authenticated crawl; never throws.

import type { ScanContext } from "./context";
import { logLine, recordFinding } from "./context";
import { probe, type ProbeResult } from "./http";
import { discoverCorpus } from "./discovery";
import { isLikelyUserParam } from "./paramFilter";
import { loadTargetCredentials, credentialHeaders } from "@/server/credentials";

const PROBE_TIMEOUT = 10_000;
const MAX_CANDIDATES = 15;

const VULN_CLASS = "Business Logic (Value Tampering)";

// Critical field-name heuristics.
const MONETARY_RE = /^(price|amount|total|cost|qty|quantity|balance|credit|points|fee)$/i;
const PRIV_BOOL_RE = /^(ispremium|isadmin|is_admin|admin|premium|vip)$/i;
const PRIV_LEVEL_RE = /^(role|tier|accesslevel|access_level|plan)$/i;

// Paths we refuse to touch: destructive, or finalizing a real payment/order.
const UNSAFE_PATH_RE =
  /(delete|remove|destroy|wipe|purge|drop|\/pay(ment)?\b|\/charge\b|\/capture\b|\/purchase\b|checkout\/confirm|order\/confirm|\/confirm-?order)/i;

type FieldKind = "monetary" | "priv-bool" | "priv-level";

function classifyField(name: string): FieldKind | null {
  if (MONETARY_RE.test(name)) return "monetary";
  if (PRIV_BOOL_RE.test(name)) return "priv-bool";
  if (PRIV_LEVEL_RE.test(name)) return "priv-level";
  return null;
}

function tamperValues(kind: FieldKind): string[] {
  switch (kind) {
    case "monetary":
      return ["0", "-1"];
    case "priv-bool":
      return ["true"];
    case "priv-level":
      return ["admin"];
  }
}

const norm = (b: string): string => b.replace(/\s+/g, "");
const looksEmpty = (b: string): boolean => norm(b).length < 32;
const ERROR_SHELL_RE =
  /"(error|errors|message|detail|code)"\s*:|not\s*found|forbidden|unauthoriz|access denied|permission|please (log|sign) ?in/i;

function isDenied(r: ProbeResult): boolean {
  if (r.status === 401 || r.status === 403) return true;
  if (r.status >= 300 && r.status < 400) {
    return /login|signin|sign-in|auth/i.test(r.headers["location"] ?? "");
  }
  return false;
}

function isRealOpen(r: ProbeResult): boolean {
  return r.status === 200 && !looksEmpty(r.body) && !ERROR_SHELL_RE.test(r.body.slice(0, 500));
}

// ---------------------------------------------------------------------------
// Candidate extraction
// ---------------------------------------------------------------------------

interface Candidate {
  /** "query" (GET url) or "form" (urlencoded POST of an HTML form). */
  via: "query" | "form";
  method: string;
  /** Request URL (form action, or the URL carrying the query param). */
  url: string;
  /** All params to send (query map or form body map), before tampering. */
  params: Record<string, string>;
  /** The critical field being tampered. */
  field: string;
  kind: FieldKind;
}

/** Minimal HTML attribute read from an opening tag. */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

/** Query-param candidates across the crawl (gated by isLikelyUserParam). */
function queryCandidates(urls: string[]): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (UNSAFE_PATH_RE.test(parsed.pathname)) continue;
    const params: Record<string, string> = {};
    for (const [k, v] of parsed.searchParams) params[k] = v;
    for (const key of Object.keys(params)) {
      const kind = classifyField(key);
      if (!kind) continue;
      if (!isLikelyUserParam(url, key)) continue;
      const dedupe = `${parsed.origin}${parsed.pathname}?${key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({ via: "query", method: "GET", url, params, field: key, kind });
    }
  }
  return out;
}

/** HTML-form candidates parsed from the crawl corpus. */
function formCandidates(html: string, baseUrl: string, host: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const openAttrs = m[1];
    const inner = m[2];
    const method = (attr(openAttrs, "method") ?? "GET").toUpperCase();
    // HTML forms only emit GET/POST; a POST that mutates is what we care about.
    if (method !== "GET" && method !== "POST") continue;

    let action: string;
    try {
      const abs = new URL(attr(openAttrs, "action") || baseUrl, baseUrl);
      if (abs.host !== host || !/^https?:$/.test(abs.protocol)) continue;
      action = abs.toString();
    } catch {
      continue;
    }
    if (UNSAFE_PATH_RE.test(new URL(action).pathname)) continue;

    const params: Record<string, string> = {};
    for (const f of inner.matchAll(/<(input|textarea|select)\b[^>]*>/gi)) {
      const tag = f[0];
      const name = attr(tag, "name");
      if (!name) continue;
      const type = (attr(tag, "type") ?? "").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset" || type === "file") continue;
      params[name] = attr(tag, "value") ?? "";
    }

    for (const key of Object.keys(params)) {
      const kind = classifyField(key);
      if (!kind) continue;
      const dedupe = `${action}#${key}#${method}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({ via: "form", method, url: action, params, field: key, kind });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Send a candidate with `field` set to `value`; everything else unchanged. */
async function send(
  c: Candidate,
  value: string,
  auth: Record<string, string>,
): Promise<ProbeResult> {
  const params = { ...c.params, [c.field]: value };
  if (c.via === "query" || c.method === "GET") {
    const u = new URL(c.url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return probe(u.toString(), { method: "GET", headers: auth, timeoutMs: PROBE_TIMEOUT });
  }
  // POST form → urlencoded body, rest of the request identical.
  const body = new URLSearchParams(params).toString();
  return probe(c.url, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    timeoutMs: PROBE_TIMEOUT,
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runBusinessLogicTamper(ctx: ScanContext): Promise<void> {
  try {
    await logLine(ctx.scanRunId, `[bl-tamper] critical-value tampering sweep on ${ctx.baseUrl}`);

    const corpus = await discoverCorpus(ctx);
    if (!corpus.html) {
      await logLine(ctx.scanRunId, `[bl-tamper] could not crawl ${ctx.baseUrl} — skipping`, "STDERR");
      return;
    }
    if (corpus.authenticated) {
      await logLine(ctx.scanRunId, `[bl-tamper] using authenticated crawl (${corpus.urls.length} URLs)`);
    }

    const host = new URL(ctx.baseUrl).host;
    const candidates = [
      ...queryCandidates(corpus.urls),
      ...formCandidates(corpus.html, ctx.baseUrl, host),
    ].slice(0, MAX_CANDIDATES);

    if (candidates.length === 0) {
      await logLine(
        ctx.scanRunId,
        `[bl-tamper] no critical-value fields (price/qty/role/plan/…) among ${corpus.urls.length} crawled URL(s) and the forms — nothing to test`,
      );
      return;
    }
    await logLine(ctx.scanRunId, `[bl-tamper] ${candidates.length} critical-field candidate(s)`);

    let auth: Record<string, string> = {};
    try {
      const creds = await loadTargetCredentials(ctx.targetId);
      if (creds[0]) auth = credentialHeaders(creds[0]);
    } catch {
      /* anonymous on failure */
    }

    let proven = 0;
    let candidateCount = 0;

    for (const c of candidates) {
      const where = `${c.field} @ ${c.method} ${new URL(c.url).pathname} (${c.via})`;
      const original = c.params[c.field] ?? "";
      const baseline = await send(c, original, auth);
      if (baseline.error) {
        await logLine(ctx.scanRunId, `[bl-tamper] ${where}: baseline error (${baseline.error}) — skipped`, "STDERR");
        continue;
      }

      if (c.kind === "priv-bool" || c.kind === "priv-level") {
        // PROVEN path: denied-before → open-after a privilege flip.
        const flip = tamperValues(c.kind)[0];
        const after = await send(c, flip, auth);
        if (after.error) {
          await logLine(ctx.scanRunId, `[bl-tamper] ${where}: tamper error (${after.error}) — skipped`, "STDERR");
          continue;
        }
        const deniedBefore = isDenied(baseline);
        const openAfter = isRealOpen(after) && norm(after.body) !== norm(baseline.body);

        if (deniedBefore && openAfter) {
          proven++;
          await recordFinding(ctx, {
            title: `Privilege escalation via value tampering: "${c.field}"=${flip}`,
            vulnClass: VULN_CLASS,
            severity: "HIGH",
            confidence: "PROVEN",
            location: c.url,
            description:
              `Setting the privilege field "${c.field}" to "${flip}" unlocked access that was ` +
              `denied with its original value. The same request returned ${baseline.status} ` +
              `(denied) with "${c.field}"="${original || "(original)"}" and 200 with a real, ` +
              `distinct body after the flip — the server trusts a client-supplied ` +
              `role/flag to gate access. Confirmed by the before/after control pair, not by any ` +
              `reflection of the value.`,
            evidence:
              `Before: ${c.method} ${c.url} "${c.field}"="${original || "(original)"}" -> ${baseline.status} (${baseline.bodyLen} bytes)\n` +
              `After:  ${c.method} ${c.url} "${c.field}"="${flip}" -> ${after.status} (${after.bodyLen} bytes, distinct non-error body)`,
          });
          await logLine(ctx.scanRunId, `[bl-tamper] PROVEN privilege tamper @ ${where}`);
          continue;
        }

        // Gated endpoint but no confirmed access change → honest CANDIDATE.
        if (deniedBefore && after.status === 200) {
          candidateCount++;
          await recordFinding(ctx, {
            title: `Possible privilege tampering on "${c.field}" (unconfirmed)`,
            vulnClass: VULN_CLASS,
            severity: "MEDIUM",
            confidence: "CANDIDATE",
            location: c.url,
            description:
              `With "${c.field}" original the endpoint returned ${baseline.status} (denied); flipping ` +
              `it to "${flip}" returned 200 but the body was empty / an error shell / identical to the ` +
              `denied response — access change NOT confirmed. Verify manually whether the flag ` +
              `genuinely unlocks privileged data.`,
            evidence:
              `Before -> ${baseline.status} (${baseline.bodyLen}B); After -> ${after.status} (${after.bodyLen}B, not a confirmed distinct resource).`,
          });
          await logLine(ctx.scanRunId, `[bl-tamper] candidate (priv, unconfirmed) @ ${where}`);
        }
        // Not gated before → the flag isn't gating access here; record nothing.
        continue;
      }

      // Monetary/quantity: generic scanners have no server-side read-back to
      // confirm the stored/charged value, so this stays CANDIDATE — and only
      // when the server ACCEPTED an absurd value (reflection is never enough).
      let accepted: { value: string; res: ProbeResult } | null = null;
      for (const v of tamperValues(c.kind)) {
        const res = await send(c, v, auth);
        if (res.error) continue;
        if (res.status >= 200 && res.status < 300 && !ERROR_SHELL_RE.test(res.body.slice(0, 500))) {
          accepted = { value: v, res };
          break;
        }
      }
      if (accepted) {
        candidateCount++;
        await recordFinding(ctx, {
          title: `Possible critical-value tampering on "${c.field}" (unconfirmed)`,
          vulnClass: VULN_CLASS,
          severity: "MEDIUM",
          confidence: "CANDIDATE",
          location: c.url,
          description:
            `The server accepted an out-of-range value "${c.field}"="${accepted.value}" ` +
            `(HTTP ${accepted.res.status}) without rejecting it. This is a LEAD only: there is no ` +
            `server-side read-back available to this scanner to confirm the stored/charged amount ` +
            `actually reflects the tampered value (a 2xx and a reflected value do not prove the ` +
            `order total or balance was recomputed). Verify manually by reading back the ` +
            `order/cart/balance after submitting.`,
          evidence:
            `Baseline "${c.field}"="${original || "(original)"}" -> ${baseline.status}; ` +
            `tampered "${c.field}"="${accepted.value}" -> ${accepted.res.status} (${accepted.res.bodyLen} bytes).`,
        });
        await logLine(ctx.scanRunId, `[bl-tamper] candidate (monetary, server accepted ${accepted.value}) @ ${where}`);
      } else {
        await logLine(ctx.scanRunId, `[bl-tamper] ${where}: tampered values rejected — server validates, no finding`);
      }
    }

    await logLine(
      ctx.scanRunId,
      `[bl-tamper] done — ${proven} proven, ${candidateCount} candidate(s) of ${candidates.length} field(s) tested`,
    );
  } catch (err) {
    await logLine(
      ctx.scanRunId,
      `[bl-tamper] errored: ${err instanceof Error ? err.message : String(err)}`,
      "STDERR",
    );
  }
}
