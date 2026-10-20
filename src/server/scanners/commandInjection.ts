// Time-based OS command injection scanner (web2-vuln-classes SKILL — RCE).
//
// AGGRESSIVENESS: TIME-BASED only. We never exfiltrate data, never go
// out-of-band, never run a destructive command. The ONLY command we inject is a
// benign `sleep`, with a modest duration (3–5s). The single thing we observe is
// whether that injected sleep shows up as response latency.
//
// EPISTEMIC HONESTY is enforced by construction, exactly as in the time-based
// SQLi scanner. A single slow response is not proof — so a finding is
// PROVEN/CRITICAL only when measureTimingDelta flags a delay for one injected
// sleep AND we reproduce it with a DIFFERENT, larger sleep, with the observed
// latency tracking the injected value (a ~5s run meaningfully slower than the
// ~3s run). Anything short of that is a CANDIDATE/MEDIUM with the exact reason it
// did not confirm. Evidence records only measured means/stddev and the two
// injected delays — never any response content, so no data can leak in.
//
// CRITICAL severity rationale: OS command injection is remote code execution —
// an injected shell command runs on the target host. Even confined to a `sleep`
// proof, a confirmed, reproducible delay means attacker-controlled input reaches
// a shell, which is the highest-impact web bug class. (The SQLi sibling is HIGH
// because blind SQLi is data read; a shell is strictly worse.)
//
// Not a fuzz: five shell-metacharacter injection contexts against a small, cap-
// bounded set of discovered GET params, PRIORITIZING params whose name suggests
// a filename / path / host / tool argument (those most often reach a shell).
// Best-effort and NEVER throwing — any failure (discovery, network) degrades to
// a logged skip or a CANDIDATE, never an abort of the run.

import { isLikelyUserParam } from "./paramFilter";
import { discoverCorpus } from "./discovery";
import { measureTimingDelta } from "./timingProbe";
import { logLine, recordFinding, type ScanContext } from "./context";
import type { Severity } from "@prisma/client";

// Cap — best-effort sweep of the most promising params, not a fuzz.
const MAX_CMDI_PARAMS = 6;
// Internal bound on how many params we collect before prioritizing + slicing,
// so a link-heavy page can't blow up discovery work.
const MAX_DISCOVER = 40;

// The two injected delays used for the reproduce-with-a-second-value rule.
const DELAY_N1 = 3; // seconds — first (screening) sleep
const DELAY_N2 = 5; // seconds — confirmation sleep (must be meaningfully slower)

// The ~5s run must beat the ~3s run by at least this much for the observed
// latency to be judged as "tracking" the 2s difference in injected sleep. 1.5s
// leaves ~0.5s of jitter tolerance below the 2s expected gap.
const REPRO_MIN_GAP_MS = 1500;

// Param names that most often carry a value passed to a system tool / shell:
// filenames, paths, hostnames/IPs, URLs, and explicit command/arg fields.
const LIKELY_SHELL =
  /file|path|dir|cmd|exec|ping|host|ip|domain|url|name|target|download/i;

interface ParamTarget {
  /** Full URL with the candidate param's value set to the __PAYLOAD__ token. */
  template: string;
  /** The parameter under test (for logging / evidence). */
  param: string;
  /** The URL as discovered (for the finding location). */
  location: string;
  /** True if the param name matched the likely-shell heuristic (sorted first). */
  likely: boolean;
}

interface CmdPayload {
  /** The shell-metacharacter context being exercised. */
  context: string;
  /** Build the injected value for an N-second sleep. */
  inject: (n: number) => string;
  /**
   * A structurally identical value that does NOT delay (N=0). Keeping the same
   * metacharacters and only varying the sleep duration isolates the delay to the
   * injected value: if nothing is interpreted, baseline ≈ inject (no delay); if a
   * shell runs it, only the duration differs — the cleanest possible control.
   */
  baseline: (n: number) => string;
}

// Five classic shell command-injection contexts. The ONLY command is `sleep`.
// `seed` is a benign leading token so separator-style payloads attach to a
// plausible prior argument (e.g. a filename) rather than starting empty.
const PAYLOADS: ReadonlyArray<CmdPayload> = [
  // Direct: the whole value is passed as an argument to a command (e.g. `sleep`
  // itself, or a tool whose arg we fully control).
  {
    context: "direct value",
    inject: (n) => `sleep ${n}`,
    baseline: (n) => `sleep ${n}`,
  },
  // Command separator.
  {
    context: "semicolon separator",
    inject: (n) => `x; sleep ${n}`,
    baseline: (n) => `x; sleep ${n}`,
  },
  // Pipe.
  {
    context: "pipe",
    inject: (n) => `x | sleep ${n}`,
    baseline: (n) => `x | sleep ${n}`,
  },
  // Backtick command substitution.
  {
    context: "backtick substitution",
    inject: (n) => `x\`sleep ${n}\``,
    baseline: (n) => `x\`sleep ${n}\``,
  },
  // $() command substitution.
  {
    context: "$() substitution",
    inject: (n) => `x$(sleep ${n})`,
    baseline: (n) => `x$(sleep ${n})`,
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
 * attributes of inputs inside GET forms (appended to the form's action). Deduped
 * by origin+path+param, bounded by MAX_DISCOVER, then prioritized so likely-shell
 * params sort first and only the top MAX_CMDI_PARAMS are returned.
 */
function discoverTargets(html: string, baseUrl: string, host: string): ParamTarget[] {
  const targets: ParamTarget[] = [];
  const seen = new Set<string>();

  const add = (rawUrl: string, param: string) => {
    if (targets.length >= MAX_DISCOVER) return;
    let abs: URL;
    try {
      abs = new URL(rawUrl, baseUrl);
    } catch {
      return;
    }
    if (abs.host !== host || !/^https?:$/.test(abs.protocol)) return;
    if (!param) return;
    if (!isLikelyUserParam(abs.toString(), param)) return; // skip static-asset/hash noise
    const key = `${abs.origin}${abs.pathname}?${param}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      template: withParam(abs.toString(), param, "__PAYLOAD__"),
      param,
      location: abs.toString(),
      likely: LIKELY_SHELL.test(param),
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
    if (targets.length >= MAX_DISCOVER) break;
  }
  if (targets.length < MAX_DISCOVER) {
    for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      let abs: URL;
      try {
        abs = new URL(m[0]);
      } catch {
        continue;
      }
      for (const key of abs.searchParams.keys()) add(abs.toString(), key);
      if (targets.length >= MAX_DISCOVER) break;
    }
  }

  // 2) GET-form input names appended to their action (default action = page).
  if (targets.length < MAX_DISCOVER) {
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
        if (targets.length >= MAX_DISCOVER) break;
      }
      if (targets.length >= MAX_DISCOVER) break;
    }
  }

  // Prioritize likely-shell params first (stable within each group), then take
  // the top MAX_CMDI_PARAMS — a param that looks like a path/host/tool arg is far
  // more likely to reach a shell than an opaque id.
  const ordered = targets
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      if (a.t.likely !== b.t.likely) return a.t.likely ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.t);

  return ordered.slice(0, MAX_CMDI_PARAMS);
}

function evidence(
  p: CmdPayload,
  t: ParamTarget,
  r1: { meanDelayMs: number; baselineMeanMs: number; baselineStdDevMs: number },
  r2?: { meanDelayMs: number; baselineMeanMs: number; baselineStdDevMs: number },
): string {
  const fmt = (x: number) => Math.round(x);
  const lines = [
    `param="${t.param}" shell-context=${p.context}`,
    `inject N=${DELAY_N1}s: mean=${fmt(r1.meanDelayMs)}ms baseline=${fmt(r1.baselineMeanMs)}ms (σ=${fmt(r1.baselineStdDevMs)}ms)`,
  ];
  if (r2) {
    lines.push(
      `inject N=${DELAY_N2}s: mean=${fmt(r2.meanDelayMs)}ms baseline=${fmt(r2.baselineMeanMs)}ms (σ=${fmt(r2.baselineStdDevMs)}ms)`,
      `delta between the two injected delays: ${fmt(r2.meanDelayMs - r1.meanDelayMs)}ms (expected ~${(DELAY_N2 - DELAY_N1) * 1000}ms)`,
    );
  }
  lines.push("(no response content recorded — time-based signal only; only a benign `sleep` was injected)");
  return lines.join("\n");
}

export async function runCommandInjection(ctx: ScanContext): Promise<void> {
  await logLine(ctx.scanRunId, `[cmdi] time-based command-injection scan of ${ctx.baseUrl}`);

  let host: string;
  try {
    host = new URL(ctx.baseUrl).host;
  } catch {
    await logLine(ctx.scanRunId, `[cmdi] bad baseUrl, skipping`, "STDERR");
    return;
  }

  const corpus = await discoverCorpus(ctx);
  if (!corpus.html) {
    await logLine(ctx.scanRunId, `[cmdi] could not crawl ${ctx.baseUrl} — skipping`, "STDERR");
    return;
  }
  if (corpus.authenticated) {
    await logLine(ctx.scanRunId, `[cmdi] using authenticated crawl (${corpus.urls.length} URLs)`);
  }

  const targets = discoverTargets(corpus.html, ctx.baseUrl, host);
  if (targets.length === 0) {
    await logLine(ctx.scanRunId, `[cmdi] no GET query params discovered — nothing to test`);
    return;
  }
  const likelyCount = targets.filter((t) => t.likely).length;
  await logLine(
    ctx.scanRunId,
    `[cmdi] testing ${targets.length} param(s) (${likelyCount} likely-shell, prioritized) ` +
      `with ${PAYLOADS.length} time-based payload(s) each`,
  );

  for (const t of targets) {
    let confirmed = false;
    // The best near-miss for this param, reported as a CANDIDATE if nothing
    // confirms (keeps the most informative reason rather than the last one).
    let candidate: { payload: CmdPayload; reason: string; evidence: string } | null = null;

    for (const p of PAYLOADS) {
      if (confirmed) break;
      try {
        // Screening run at N1 seconds.
        const r1 = await measureTimingDelta(
          t.template,
          p.inject(DELAY_N1),
          p.baseline(0),
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
          p.baseline(0),
        );
        const gap = r2.meanDelayMs - r1.meanDelayMs;
        const tracks = r2.delayObserved && gap >= REPRO_MIN_GAP_MS;

        if (tracks) {
          confirmed = true;
          await recordFinding(ctx, {
            title: `OS command injection — param "${t.param}" (${p.context})`,
            vulnClass: "Command Injection",
            severity: "CRITICAL" as Severity,
            confidence: "PROVEN",
            location: t.location,
            description:
              `A benign \`sleep\` injected into "${t.param}" via a ${p.context} ` +
              `produced a server delay that reproduced with a second, larger ` +
              `sleep: the ~${DELAY_N1}s payload and the ~${DELAY_N2}s payload both ` +
              `cleared baseline variance, and the observed latency tracked the ` +
              `injected delay (${Math.round(gap)}ms slower for +${DELAY_N2 - DELAY_N1}s ` +
              `injected). Attacker-controlled input reaches a shell — this is ` +
              `remote code execution (hence CRITICAL). Only a non-destructive ` +
              `\`sleep\` was used to prove it; no data was read or exfiltrated.\n\n` +
              `Confirm manually (e.g. a distinct benign command with observable ` +
              `output) before reporting if the program requires it.`,
            evidence: evidence(p, t, r1, r2),
          });
          await logLine(
            ctx.scanRunId,
            `[cmdi] PROVEN command injection on "${t.param}" (${p.context})`,
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
          `[cmdi] payload errored on "${t.param}" (${p.context}): ${err instanceof Error ? err.message : String(err)} — skipping`,
          "STDERR",
        );
      }
    }

    if (!confirmed && candidate) {
      await recordFinding(ctx, {
        title: `Possible command-injection candidate — param "${t.param}"`,
        vulnClass: "Command Injection",
        severity: "MEDIUM" as Severity,
        confidence: "CANDIDATE",
        location: t.location,
        description:
          `Parameter "${t.param}" was probed with time-based shell payloads ` +
          `(${candidate.payload.context}) but did NOT confirm: ${candidate.reason}. ` +
          `Recorded as a candidate for manual review — a reproducible delay across ` +
          `two different injected sleeps was not observed, so this is not proof of ` +
          `command injection.`,
        evidence: candidate.evidence,
      });
    }
  }

  await logLine(ctx.scanRunId, `[cmdi] done`);
}
