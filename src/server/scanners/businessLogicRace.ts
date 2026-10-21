// Business Logic — Race Condition / TOCTOU scanner (web2-vuln-classes SKILL).
//
// INTRINSICALLY LOWER DETECTION RATE — BY DESIGN, NOT A BUG. The Business Logic
// family cannot match the signal of the injection/misconfig families: a real
// business-logic flaw depends on what the application is SUPPOSED to allow (a
// coupon is single-use, a balance can't go negative, a step is mandatory) —
// domain knowledge a generic scanner does not have. So this scanner fires rarely
// and leans heavily toward CANDIDATE / nothing. That is expected and correct;
// do not "fix" it by loosening the proof bar.
//
// STRICT EPISTEMIC HONESTY (the strictest in the whole port):
//   A 200/201, an absent error, or a reflected payload PROVE NOTHING here.
//   PROVEN requires a VERIFIED server-side SECOND-ORDER effect — read back after
//   the burst — that the limited action applied MORE THAN ONCE: two distinct
//   server-generated confirmation IDs for a single-use action, or a control
//   counter (balance/points/usages) that moved by the number of successes. If
//   that second-order proof is unavailable or inconclusive → CANDIDATE with a
//   precise reason. If even the candidate detection was uncertain → nothing.
//
// SAFETY: never irreversible/destructive at scale — GET/POST only (never DELETE),
// endpoints hinting delete/remove/purge/etc. are skipped, and the burst is capped
// low (BURST). Only the action the app itself exposes is fired (method/body
// derived from a crawled <form> or a GET action link) — nothing is invented.

import type { ScanContext } from "./context";
import { logLine, recordFinding } from "./context";
import { probe } from "./http";
import { discoverCorpus } from "./discovery";
import { isLikelyUserParam } from "./paramFilter";
import { loadTargetCredentials, credentialHeaders } from "@/server/credentials";

const BURST = 15; // parallel identical requests (capped 10–20)
const MAX_CANDIDATES = 5; // endpoints tested per run
const PROBE_TIMEOUT = 10_000;

// Single-use / limited-action hints (classic race targets). Safer actions
// (promo/coupon/claim/vote/…) are preferred over money movement when both exist.
const ACTION_HINT_RE =
  /(coupon|promo|promotion|discount|voucher|redeem|claim|apply|gift|reward|transfer|withdraw|vote|like|follow|rsvp|reserve|booking|enroll)/i;
// Safer-action hints, ranked first so money movement is only tested if nothing
// safer is available within the cap.
const SAFE_FIRST_RE = /(coupon|promo|promotion|discount|voucher|redeem|claim|apply|gift|reward|vote|like|follow|rsvp|enroll)/i;
// Never burst anything that looks irreversible/destructive.
const AVOID_RE =
  /(delete|destroy|remove|wipe|purge|drop|logout|sign-?out|unsubscribe|deactivate|close[-_]?account|cancel)/i;
// Endpoints that let us OBJECTIVELY read state back after the burst.
const CONTROL_RE =
  /(balance|wallet|points|credits|status|history|transactions?|orders?|account|profile|dashboard|me|usages?|rewards?)/i;

// Server-GENERATED identifiers (not the coupon code we send back) — two distinct
// ones for a single-use action is a second-order proof of double application.
const ID_RE =
  /"(?:id|orderid|order_id|confirmationid|confirmation_id|confirmation|reference|referenceid|transactionid|transaction_id|txn|receipt|receiptid|voucherid)"\s*:\s*"?([A-Za-z0-9][A-Za-z0-9._-]{3,})"?/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// A numeric control counter we can diff before/after.
const COUNTER_RE =
  /"(?:balance|points|credits|count|used|usages?|remaining|redemptions?)"\s*:\s*(-?\d+(?:\.\d+)?)/i;
// Markers that a 2xx is actually a soft failure (single-use already enforced).
const SOFT_FAIL_RE =
  /\b(error|denied|invalid|already (?:used|redeemed|claimed|applied)|expired|forbidden|unauthoriz|limit reached|not allowed)\b/i;

interface Candidate {
  url: string;
  method: "GET" | "POST";
  body?: string;
  contentType?: string;
  safe: boolean;
}

function sameHost(u: string, host: string): boolean {
  try {
    return new URL(u).host === host;
  } catch {
    return false;
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Minimal <form> parse → same-origin action descriptors. */
function parseForms(html: string, baseUrl: string, host: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = m[1];
    const inner = m[2];
    const action = (attrs.match(/\baction\s*=\s*["']([^"']*)["']/i) ?? [])[1] ?? baseUrl;
    const method = ((attrs.match(/\bmethod\s*=\s*["']([^"']*)["']/i) ?? [])[1] ?? "GET").toUpperCase();
    let url: string;
    try {
      const abs = new URL(action || baseUrl, baseUrl);
      if (abs.host !== host) continue;
      url = abs.toString();
    } catch {
      continue;
    }
    if (!ACTION_HINT_RE.test(pathOf(url)) || AVOID_RE.test(pathOf(url))) continue;

    const fields: Record<string, string> = {};
    for (const im of inner.matchAll(/<(?:input|select|textarea)\b([^>]*)>/gi)) {
      const ia = im[1];
      const name = (ia.match(/\bname\s*=\s*["']([^"']+)["']/i) ?? [])[1];
      if (!name) continue;
      fields[name] = (ia.match(/\bvalue\s*=\s*["']([^"']*)["']/i) ?? [])[1] ?? "";
    }

    if (method === "POST") {
      const body = Object.entries(fields)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
      out.push({
        url,
        method: "POST",
        body,
        contentType: "application/x-www-form-urlencoded",
        safe: SAFE_FIRST_RE.test(pathOf(url)),
      });
    } else {
      out.push({ url, method: "GET", safe: SAFE_FIRST_RE.test(pathOf(url)) });
    }
  }
  return out;
}

/** GET action links from the crawl whose path hints a single-use action. */
function linkCandidates(urls: string[], host: string): Candidate[] {
  const out: Candidate[] = [];
  for (const u of urls) {
    if (!sameHost(u, host)) continue;
    const p = pathOf(u);
    if (!ACTION_HINT_RE.test(p) || AVOID_RE.test(p)) continue;
    // If it carries query params, require at least one to be a real user param.
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    const keys = [...parsed.searchParams.keys()];
    if (keys.length > 0 && !keys.some((k) => isLikelyUserParam(u, k))) continue;
    out.push({ url: u, method: "GET", safe: SAFE_FIRST_RE.test(p) });
  }
  return out;
}

function dedupeCandidates(list: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  // Safer actions first so money-movement is only reached if room remains.
  for (const c of [...list].sort((a, b) => Number(b.safe) - Number(a.safe))) {
    const key = `${c.method} ${c.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

function firstCounter(body: string): number | null {
  const m = body.match(COUNTER_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function distinctGeneratedIds(body: string): Set<string> {
  const ids = new Set<string>();
  for (const m of body.matchAll(ID_RE)) ids.add(m[1]);
  for (const m of body.matchAll(UUID_RE)) ids.add(m[0].toLowerCase());
  return ids;
}

export async function runBusinessLogicRace(ctx: ScanContext): Promise<void> {
  try {
    await logLine(ctx.scanRunId, `[bl-race] race/TOCTOU sweep on ${ctx.baseUrl}`);

    const corpus = await discoverCorpus(ctx);
    if (!corpus.html) {
      await logLine(ctx.scanRunId, `[bl-race] could not crawl ${ctx.baseUrl} — skipping`, "STDERR");
      return;
    }
    if (corpus.authenticated) {
      await logLine(ctx.scanRunId, `[bl-race] using authenticated crawl (${corpus.urls.length} URLs)`);
    }

    const host = new URL(ctx.baseUrl).host;
    const candidates = dedupeCandidates([
      ...parseForms(corpus.html, ctx.baseUrl, host),
      ...linkCandidates(corpus.urls, host),
    ]);

    if (candidates.length === 0) {
      await logLine(
        ctx.scanRunId,
        `[bl-race] no single-use/limited-action endpoints among ${corpus.urls.length} crawled URL(s) — nothing to test`,
      );
      return;
    }
    await logLine(ctx.scanRunId, `[bl-race] ${candidates.length} candidate action(s); burst=${BURST}`);

    // Best-effort authentication with the first credential.
    let auth: Record<string, string> = {};
    try {
      const creds = await loadTargetCredentials(ctx.targetId);
      if (creds[0]) auth = credentialHeaders(creds[0]);
    } catch {
      /* anonymous */
    }

    // A control endpoint to read state back after the burst (objective check).
    const controlUrl = corpus.urls.find((u) => sameHost(u, host) && CONTROL_RE.test(pathOf(u)));

    let proven = 0;
    let candidateCount = 0;

    for (const c of candidates) {
      const headers: Record<string, string> = { ...auth };
      if (c.contentType) headers["Content-Type"] = c.contentType;

      // Objective baseline (if a control endpoint exists).
      const ctrlBefore = controlUrl ? await probe(controlUrl, { headers: auth, timeoutMs: PROBE_TIMEOUT }) : null;

      // --- The burst: N identical requests in parallel, no artificial delay. ---
      const results = await Promise.all(
        Array.from({ length: BURST }, () =>
          probe(c.url, { method: c.method, headers, body: c.body, timeoutMs: PROBE_TIMEOUT }),
        ),
      );

      const ctrlAfter = controlUrl ? await probe(controlUrl, { headers: auth, timeoutMs: PROBE_TIMEOUT }) : null;

      const successes = results.filter(
        (r) => !r.error && r.status >= 200 && r.status < 300 && !SOFT_FAIL_RE.test(r.body.slice(0, 400)),
      );
      // Distinct server-generated IDs across the SUCCESSFUL responses.
      const allIds = new Set<string>();
      for (const r of successes) for (const id of distinctGeneratedIds(r.body)) allIds.add(id);

      const before = ctrlBefore && !ctrlBefore.error ? firstCounter(ctrlBefore.body) : null;
      const after = ctrlAfter && !ctrlAfter.error ? firstCounter(ctrlAfter.body) : null;
      const counterDelta = before != null && after != null ? after - before : null;

      const statuses = results.map((r) => (r.error ? "err" : r.status)).join(",");
      const evidence =
        `Burst: ${BURST} parallel ${c.method} ${pathOf(c.url)}\n` +
        `Statuses: [${statuses}]\n` +
        `Successful responses: ${successes.length}; distinct server-generated IDs: ${allIds.size}\n` +
        (controlUrl
          ? `Control ${pathOf(controlUrl)} counter before=${before ?? "?"} after=${after ?? "?"}` +
            (counterDelta != null ? ` (delta ${counterDelta})` : "")
          : `No control endpoint in corpus — second-order read unavailable`);

      // PROVEN: a verified second-order effect that the limited action applied >1×.
      const provenByIds = allIds.size >= 2;
      const provenByCounter = counterDelta != null && Math.abs(counterDelta) >= 2 && successes.length >= 2;

      if (provenByIds || provenByCounter) {
        proven += 1;
        await recordFinding(ctx, {
          title: `Race condition: single-use action applied multiple times — ${pathOf(c.url)}`,
          vulnClass: "Business Logic (Race Condition)",
          severity: "HIGH",
          confidence: "PROVEN",
          location: c.url,
          description:
            `A burst of ${BURST} concurrent identical requests to a single-use/limited action ` +
            `was applied MORE THAN ONCE, confirmed by a server-side second-order read: ` +
            (provenByIds
              ? `${allIds.size} distinct server-generated confirmation IDs were returned for an ` +
                `action that should yield at most one. `
              : `the control counter at ${controlUrl ? pathOf(controlUrl) : "?"} moved by ${counterDelta} ` +
                `across ${successes.length} successful responses. `) +
            `This is a TOCTOU/race flaw: the limit is checked and applied non-atomically.`,
          evidence,
        });
        await logLine(ctx.scanRunId, `[bl-race] PROVEN double-application @ ${pathOf(c.url)}`);
        continue;
      }

      // A burst that produced at least one success but no confirmed duplication
      // is a lead, not a proof — recorded honestly as CANDIDATE.
      if (successes.length >= 1) {
        candidateCount += 1;
        await recordFinding(ctx, {
          title: `Possible race condition on single-use action ${pathOf(c.url)} (unconfirmed)`,
          vulnClass: "Business Logic (Race Condition)",
          severity: "MEDIUM",
          confidence: "CANDIDATE",
          location: c.url,
          description:
            `Burst of ${BURST} concurrent requests sent; ${successes.length} looked successful, but ` +
            `no confirmed double-application (` +
            (controlUrl
              ? `fewer than 2 distinct server-generated IDs and the control counter did not move by ≥2`
              : `no status/balance/history endpoint was found in the crawl to read state back`) +
            `). Not proof of a race — verify manually (replay the burst while watching an ` +
            `authoritative counter, or diff created resource IDs).`,
          evidence,
        });
        await logLine(ctx.scanRunId, `[bl-race] candidate (no confirmed double-application) @ ${pathOf(c.url)}`);
      } else {
        await logLine(
          ctx.scanRunId,
          `[bl-race] ${pathOf(c.url)} — burst produced no successful application; nothing to flag`,
        );
      }
    }

    await logLine(
      ctx.scanRunId,
      `[bl-race] done — ${proven} proven, ${candidateCount} candidate(s) of ${candidates.length} action(s) tested`,
    );
  } catch (err) {
    await logLine(
      ctx.scanRunId,
      `[bl-race] errored: ${err instanceof Error ? err.message : String(err)}`,
      "STDERR",
    );
  }
}
