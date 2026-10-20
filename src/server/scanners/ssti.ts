// Server-Side Template Injection (SSTI) scanner (web2-vuln-classes SKILL).
//
// EPISTEMIC HONESTY is the whole point of this module — the same content-
// consistency discipline as the Phase-8 Auth-Bypass fix. SSTI is confirmed by
// CONTENT EVALUATION, never by timing: the only proof that a template engine
// executed our input is that the ARITHMETIC RESULT (e.g. 49 for 7*7) comes back
// where the payload was injected, while the raw payload (the literal `{{7*7}}`)
// is absent. A payload reflected verbatim means the engine did NOT evaluate it
// (that is plain reflection, an XSS lead at most), so it is a CANDIDATE, never
// PROVEN.
//
// To defeat coincidence ("49" already on the page) and to prove the result
// landed AT/NEAR the injection point, each payload is wrapped in a unique,
// template-inert marker: we inject `<marker>{{7*7}}<marker>` and look for
// `<marker>49<marker>` (evaluated) vs `<marker>{{7*7}}<marker>` (reflected
// literally). Even with that localisation, a single lucky "49" is not enough —
// PROVEN requires a SECOND, different arithmetic payload (`{{8*8}}` -> 64) to
// evaluate the same way. Only when BOTH the 49 and 64 checks pass do we conclude
// PROVEN (HIGH). Everything else is CANDIDATE with the precise reason.
//
// Never throws: any network/parse failure degrades to a logged skip or a
// CANDIDATE. recordFinding always creates an UNVALIDATED Finding — the manual
// 7-Question Gate is never bypassed.

import { probe } from "./http";
import { logLine, recordFinding, type ScanContext } from "./context";
import type { Severity } from "@prisma/client";

// Best-effort sweep, not an exhaustive fuzz — bound request volume hard.
const MAX_SSTI_PARAMS = 6;

// Template engine families and their characteristic arithmetic payloads. Each
// family contributes two payloads: one that must yield 49 (7*7) and one that
// must yield 64 (8*8) for the disambiguation pass. The marker-inert core is what
// we search for verbatim to detect un-evaluated reflection.
interface Engine {
  family: string;
  /** Core payload yielding 49 (7*7). */
  core49: string;
  /** Core payload yielding 64 (8*8), same syntax — for disambiguation. */
  core64: string;
}

const ENGINES: ReadonlyArray<Engine> = [
  { family: "Jinja2/Twig", core49: "{{7*7}}", core64: "{{8*8}}" },
  { family: "FreeMarker/Velocity/EL", core49: "${7*7}", core64: "${8*8}" },
  { family: "Ruby ERB/Pebble", core49: "#{7*7}", core64: "#{8*8}" },
  { family: "ERB", core49: "<%= 7*7 %>", core64: "<%= 8*8 %>" },
];

// Params that commonly reach a template render when the page exposes none.
const GUESS_PARAMS = [
  "name",
  "q",
  "search",
  "query",
  "message",
  "template",
  "view",
  "page",
  "title",
];

interface ParamTarget {
  /** Absolute URL the param lives on (base for the injected request). */
  url: string;
  /** The parameter name to inject into. */
  param: string;
  /** Where it came from — for the evidence/log line. */
  source: string;
}

/** Same-origin absolute URLs referenced by href/src/action in an HTML document. */
function extractUrls(html: string, baseUrl: string, host: string): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    try {
      const abs = new URL(raw, baseUrl);
      if (abs.host === host && /^https?:$/.test(abs.protocol)) out.add(abs.toString());
    } catch {
      /* ignore malformed */
    }
  };
  for (const m of html.matchAll(/(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) add(m[0]);
  return [...out];
}

/**
 * Extract GET-form parameter targets: for each <form> whose method is GET (or
 * unspecified, which defaults to GET), pair its action URL with each named
 * field. Never throws on malformed markup.
 */
function extractFormParams(html: string, baseUrl: string, host: string): ParamTarget[] {
  const out: ParamTarget[] = [];
  for (const fm of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = fm[1];
    const inner = fm[2];
    const method = (attrs.match(/\bmethod\s*=\s*["']?([a-z]+)/i)?.[1] ?? "get").toLowerCase();
    if (method !== "get") continue; // only GET params land in the query string
    const actionRaw = attrs.match(/\baction\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    let actionUrl: string;
    try {
      const abs = new URL(actionRaw || baseUrl, baseUrl);
      if (abs.host !== host || !/^https?:$/.test(abs.protocol)) continue;
      actionUrl = abs.toString();
    } catch {
      continue;
    }
    for (const field of inner.matchAll(/<(?:input|textarea|select)\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi)) {
      out.push({ url: actionUrl, param: field[1], source: `GET form ${actionUrl}` });
    }
  }
  return out;
}

/**
 * Build the capped list of (url, param) targets to probe: every query param on
 * every discovered link, plus GET-form fields, plus guessed params on the base
 * URL when the page exposes none. De-duplicated by origin+path+param.
 */
function buildTargets(html: string, baseUrl: string, host: string): ParamTarget[] {
  const targets: ParamTarget[] = [];
  const seen = new Set<string>();
  const push = (t: ParamTarget) => {
    let parsed: URL;
    try {
      parsed = new URL(t.url);
    } catch {
      return;
    }
    const key = `${parsed.origin}${parsed.pathname}?${t.param}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(t);
  };

  for (const u of extractUrls(html, baseUrl, host)) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    for (const key of parsed.searchParams.keys()) {
      push({ url: u, param: key, source: `query param on ${parsed.pathname}` });
    }
  }
  for (const t of extractFormParams(html, baseUrl, host)) push(t);

  if (targets.length === 0) {
    for (const key of GUESS_PARAMS) {
      push({ url: baseUrl, param: key, source: "guessed param on base URL" });
    }
  }
  return targets.slice(0, MAX_SSTI_PARAMS);
}

/** Replace (or add) `param`'s value with `value` on `url`. */
function withParam(url: string, param: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(param, value);
  return u.toString();
}

/** One engine probe outcome against a single param. */
type EngineVerdict =
  | { kind: "proven"; evidence: string }
  | { kind: "candidate"; severity: Severity; reason: string; evidence: string }
  | { kind: "none" };

/**
 * Probe one engine family against one param. Pure control flow around probe()
 * (which itself never throws). Applies the PROVEN vs CANDIDATE rules:
 *   - PROVEN only if BOTH `<marker>49<marker>` (7*7) AND `<marker>64<marker>`
 *     (8*8) appear while the respective raw payloads are absent.
 *   - literal reflection of the payload -> CANDIDATE (not evaluated).
 *   - a single arithmetic hit that the disambiguation payload does not confirm
 *     -> CANDIDATE (not enough to conclude execution).
 */
async function probeEngine(
  ctx: ScanContext,
  t: ParamTarget,
  marker: string,
  engine: Engine,
): Promise<EngineVerdict> {
  const evalTok = (n: string) => `${marker}${n}${marker}`;

  // First payload: 7*7 -> 49, wrapped in the inert marker to localise + de-coincide.
  const url49 = withParam(t.url, t.param, `${marker}${engine.core49}${marker}`);
  const r49 = await probe(url49, { timeoutMs: 10_000 });
  if (r49.error) return { kind: "none" };

  const evaluated49 = r49.body.includes(evalTok("49"));
  const literal49 =
    r49.body.includes(`${marker}${engine.core49}${marker}`) || r49.body.includes(engine.core49);

  // Literal reflection, no evaluation: the engine did NOT execute our input.
  if (!evaluated49 && literal49) {
    return {
      kind: "candidate",
      severity: "LOW",
      reason:
        `payload reflected literally, not evaluated — template injection not confirmed ` +
        `(the raw ${engine.family} payload "${engine.core49}" came back verbatim; a reflected ` +
        `payload is at most an XSS lead, not SSTI)`,
      evidence:
        `GET ${url49}\n-> status ${r49.status}, raw payload "${marker}${engine.core49}${marker}" ` +
        `present in response (not evaluated)`,
    };
  }

  // No arithmetic result and no literal reflection: nothing to say for this engine.
  if (!evaluated49) return { kind: "none" };

  // We have `<marker>49<marker>` AND the raw payload is absent — strong, but a
  // single lucky 49 is not enough. Disambiguate with 8*8 -> 64.
  const url64 = withParam(t.url, t.param, `${marker}${engine.core64}${marker}`);
  const r64 = await probe(url64, { timeoutMs: 10_000 });
  const evaluated64 = !r64.error && r64.body.includes(evalTok("64"));
  const literal64 =
    !r64.error &&
    (r64.body.includes(`${marker}${engine.core64}${marker}`) || r64.body.includes(engine.core64));

  if (evaluated64 && !literal64) {
    return {
      kind: "proven",
      evidence:
        `Engine family: ${engine.family}\n` +
        `Payload 1: GET ${url49}\n` +
        `  -> "${evalTok("49")}" present (7*7 evaluated to 49); raw "${engine.core49}" absent\n` +
        `Payload 2 (disambiguation): GET ${url64}\n` +
        `  -> "${evalTok("64")}" present (8*8 evaluated to 64); raw "${engine.core64}" absent\n` +
        `Both arithmetic payloads evaluated at the injection point while their literals ` +
        `were absent — the template engine executed attacker input.`,
    };
  }

  // 49 fired but the 64 confirmation did not — honestly, not enough.
  return {
    kind: "candidate",
    severity: "MEDIUM",
    reason:
      `"${evalTok("49")}" appeared (7*7 may have evaluated) but the disambiguation payload ` +
      `"${marker}${engine.core64}${marker}" did NOT yield "${evalTok("64")}" ` +
      `(${r64.error ? `request error: ${r64.error}` : literal64 ? "it reflected literally" : "no evaluated result"}) ` +
      `— a single arithmetic hit is not sufficient to confirm ${engine.family} SSTI; verify manually`,
    evidence:
      `Payload 1: GET ${url49} -> "${evalTok("49")}" present\n` +
      `Payload 2: GET ${url64} -> "${evalTok("64")}" ${evaluated64 ? "present" : "absent"}` +
      `${r64.error ? ` (error: ${r64.error})` : ""}`,
  };
}

export async function runSsti(ctx: ScanContext): Promise<void> {
  await logLine(ctx.scanRunId, `[ssti] scanning ${ctx.baseUrl} (content-evaluation, 7*7 -> 49 + 8*8 -> 64)`);

  let host: string;
  try {
    host = new URL(ctx.baseUrl).host;
  } catch {
    await logLine(ctx.scanRunId, `[ssti] invalid base URL ${ctx.baseUrl} — skipping`, "STDERR");
    return;
  }

  const root = await probe(ctx.baseUrl, { timeoutMs: 10_000 });
  if (root.error) {
    await logLine(ctx.scanRunId, `[ssti] could not fetch ${ctx.baseUrl}: ${root.error}`, "STDERR");
    return;
  }

  const targets = buildTargets(root.body, ctx.baseUrl, host);
  await logLine(
    ctx.scanRunId,
    `[ssti] ${targets.length} candidate param target(s) (cap ${MAX_SSTI_PARAMS})`,
  );

  let proven = 0;
  let candidates = 0;

  for (const t of targets) {
    try {
      // Unique, template-inert marker (alphanumeric only — no $, {, }, #, < so no
      // engine can interpret it). Used both to baseline the param's reflection and
      // to wrap each payload so results are located at the injection point.
      const marker = `ssti${Math.random().toString(36).slice(2, 10)}`;

      // Baseline: a harmless marker value tells us whether/where the param reflects.
      const baseUrl = withParam(t.url, t.param, marker);
      const baseRes = await probe(baseUrl, { timeoutMs: 10_000 });
      const reflects = !baseRes.error && baseRes.body.includes(marker);
      await logLine(
        ctx.scanRunId,
        `[ssti] ${t.param} (${t.source}) — baseline ${baseRes.error ? `error: ${baseRes.error}` : `status ${baseRes.status}, marker ${reflects ? "reflected" : "not reflected"}`}`,
      );

      // Try each engine family; stop at the first PROVEN, otherwise keep the
      // strongest CANDIDATE (MEDIUM partial-eval over LOW literal reflection).
      let best: Extract<EngineVerdict, { kind: "candidate" }> | null = null;
      let provenHere = false;

      for (const engine of ENGINES) {
        const v = await probeEngine(ctx, t, marker, engine);
        if (v.kind === "proven") {
          proven += 1;
          provenHere = true;
          await recordFinding(ctx, {
            title: `Server-Side Template Injection (${engine.family}) in "${t.param}"`,
            vulnClass: "SSTI",
            severity: "HIGH",
            confidence: "PROVEN",
            location: t.url,
            description:
              `The "${t.param}" parameter (${t.source}) is evaluated by a ${engine.family} ` +
              `template engine. Two independent arithmetic payloads evaluated server-side ` +
              `(7*7 -> 49 and 8*8 -> 64), each appearing wrapped in a unique marker at the ` +
              `injection point while the raw payloads were absent — proof of code evaluation, ` +
              `not reflection. SSTI commonly escalates to RCE depending on the engine and ` +
              `sandbox; verify the exploitation primitive for ${engine.family}.`,
            evidence: v.evidence,
          });
          await logLine(ctx.scanRunId, `[ssti] PROVEN ${engine.family} SSTI in "${t.param}"`);
          break;
        }
        if (v.kind === "candidate") {
          if (!best || (best.severity === "LOW" && v.severity === "MEDIUM")) best = v;
        }
      }

      if (!provenHere && best) {
        candidates += 1;
        await recordFinding(ctx, {
          title: `Possible template injection in "${t.param}" (unconfirmed)`,
          vulnClass: "SSTI",
          severity: best.severity,
          confidence: "CANDIDATE",
          location: t.url,
          description:
            `The "${t.param}" parameter (${t.source}) showed a template-injection signal that ` +
            `could NOT be confirmed by content evaluation: ${best.reason}.`,
          evidence: best.evidence,
        });
        await logLine(
          ctx.scanRunId,
          `[ssti] candidate (${best.severity}) in "${t.param}": ${best.reason}`,
        );
      }
    } catch (err) {
      // A single param must never abort the sweep.
      await logLine(
        ctx.scanRunId,
        `[ssti] ${t.param} errored: ${err instanceof Error ? err.message : String(err)}`,
        "STDERR",
      );
    }
  }

  await logLine(
    ctx.scanRunId,
    `[ssti] done — ${proven} proven, ${candidates} candidate(s) across ${targets.length} param target(s)`,
  );
}
