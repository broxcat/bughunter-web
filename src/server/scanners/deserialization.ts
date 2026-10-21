// Insecure-deserialization detector (web2-vuln-classes SKILL) — PASSIVE ONLY.
//
// This scanner is deliberately NOT an exploiter. Confirming an insecure
// deserialization bug requires a target-specific gadget chain (ysoserial for
// Java, a PHP POP chain, a pickle reducer, a .NET TypeConfuseDelegate, …) that
// cannot be generated generically or fired safely by an automated scanner — a
// working gadget is remote code execution, and guessing one blindly is both
// unreliable and dangerous. So this module only AUDITS: it looks for the
// signatures of serialized objects flowing through the app (cookies, query
// params, hidden form fields) and surfaces each as a CANDIDATE a human must then
// verify with the right target-specific tooling.
//
// Because a signature is an audit signal and not proof of exploitability, every
// finding here is CANDIDATE / MEDIUM — never PROVEN, never HIGH/CRITICAL. We do
// not escalate on a signature alone and we never pretend a signature is an
// exploit.
//
// It consumes the shared authenticated crawl (discoverCorpus) and never throws.

import type { ScanContext } from "./context";
import { logLine, recordFinding } from "./context";
import { probe } from "./http";
import { discoverCorpus } from "./discovery";
import { isLikelyUserParam } from "./paramFilter";

// Cap on how many signature hits we record per run.
const MAX_FINDINGS = 15;

// The mandatory honesty caveat embedded in every finding.
const EXPLOIT_NOTE = (type: string): string =>
  `Serialized object signature detected (type: ${type}) — manual verification with ` +
  `target-specific tooling required to confirm exploitability. Automated exploitation ` +
  `of deserialization gadgets is out of scope for this scanner.`;

// Known serialized-format signatures. Each test runs against a single token
// value (raw or decoded). Ordered most-specific first.
const SIGNATURES: ReadonlyArray<{ type: string; test: (v: string) => boolean }> = [
  // Java: ObjectOutputStream stream magic 0xAC 0xED 0x00 0x05 -> base64 "rO0AB…".
  { type: "Java serialized object (base64)", test: (v) => /^rO0AB/.test(v) || /^rO0[A-Za-z0-9+/]/.test(v) },
  // .NET ViewState / LosFormatter: 0xFF 0x01 -> base64 "/wE…".
  { type: ".NET ViewState / LosFormatter (base64)", test: (v) => /^\/wE[A-Za-z0-9+/]/.test(v) },
  // PHP serialize(): object `O:<len>:"Class":` or array `a:<len>:{`.
  { type: "PHP serialized object", test: (v) => /(^|[;&=])O:\d+:"/.test(v) || /(^|[;&=])a:\d+:\{/.test(v) },
  // Python pickle PROTO opcode 0x80 <ver> -> base64 "gA" + {N,J,S,V,v,A,M,Q}.
  { type: "Python pickle (base64)", test: (v) => /^gA[NJSVvAMQ][A-Za-z0-9+/]/.test(v) },
];

/** First matching signature type for a value, or null. */
function classify(value: string): string | null {
  const v = value.trim();
  if (v.length < 6) return null;
  for (const s of SIGNATURES) if (s.test(v)) return s.type;
  return null;
}

/** URL-decode defensively; return the input unchanged if it is not encoded. */
function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Classify a value trying both its raw and URL-decoded forms. */
function classifyEither(value: string): string | null {
  return classify(value) ?? classify(safeDecode(value));
}

/** First 16 chars of a token, redacted — never dump a full cookie/token value. */
function redact(v: string): string {
  const t = v.trim();
  return t.length > 16 ? `${t.slice(0, 16)}…` : t;
}

/**
 * Split a Set-Cookie header (which may hold several cookies joined with ", ")
 * into individual "name=value; attrs" chunks. Splits only on a comma that is
 * followed by a new `cookie-name=`, so a comma inside an Expires date is kept.
 */
function splitSetCookie(raw: string): string[] {
  return raw.split(/,(?=\s*[A-Za-z0-9_.\-]+=)/).map((c) => c.trim()).filter(Boolean);
}

export async function runDeserialization(ctx: ScanContext): Promise<void> {
  await logLine(
    ctx.scanRunId,
    `[deser] passive serialized-object signature audit on ${ctx.baseUrl} (detection only, no exploitation)`,
  );

  const corpus = await discoverCorpus(ctx);
  if (!corpus.html) {
    await logLine(ctx.scanRunId, `[deser] could not crawl ${ctx.baseUrl} — skipping`, "STDERR");
    return;
  }
  if (corpus.authenticated) {
    await logLine(ctx.scanRunId, `[deser] using authenticated crawl (${corpus.urls.length} URLs)`);
  }

  let found = 0;
  const seen = new Set<string>();

  const record = async (
    source: string,
    name: string,
    type: string,
    location: string,
    token: string,
  ): Promise<void> => {
    if (found >= MAX_FINDINGS) return;
    const key = `${source}:${type}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    found += 1;
    await recordFinding(ctx, {
      title: `Serialized object signature detected (${type}) in ${source} "${name}"`,
      vulnClass: "Insecure Deserialization",
      severity: "MEDIUM",
      confidence: "CANDIDATE",
      location,
      description:
        `${EXPLOIT_NOTE(type)}\n\n` +
        `A ${source} ("${name}") on this target carries a value whose format matches a known ` +
        `object-serialization encoding. If the server deserializes this value without ` +
        `validation, it may be vulnerable to insecure deserialization (potential RCE). ` +
        `This is a passive signal only — confirm by hand with tooling appropriate to the ` +
        `serialization format above.`,
      evidence: `${source} "${name}" @ ${location}\nvalue prefix (redacted): ${redact(token)}`,
    });
    await logLine(ctx.scanRunId, `[deser] signature: ${type} in ${source} "${name}"`);
  };

  // 1) Query-param values across the crawled URLs.
  for (const u of corpus.urls) {
    if (found >= MAX_FINDINGS) break;
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    for (const [key, value] of parsed.searchParams) {
      if (!value || !isLikelyUserParam(u, key)) continue;
      const type = classifyEither(value);
      if (type) await record("query param", key, type, u, value);
    }
  }

  // 2) Hidden form fields in the crawl corpus (classic .NET __VIEWSTATE et al.).
  for (const m of corpus.html.matchAll(/<input\b[^>]*>/gi)) {
    if (found >= MAX_FINDINGS) break;
    const tag = m[0];
    const name = (tag.match(/\bname\s*=\s*["']([^"']+)["']/i) ?? [])[1];
    if (!name) continue;
    const value = (tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i) ?? [])[1] ?? "";
    if (/^__VIEWSTATE$/i.test(name)) {
      // Presence of a __VIEWSTATE field is itself the .NET signal; the value (if
      // any) refines it. A ViewState without a MAC suffix is the classic risk,
      // but we cannot verify MAC state passively — note it, stay CANDIDATE.
      const type = value ? classifyEither(value) ?? ".NET ViewState" : ".NET ViewState";
      await record("hidden field", name, type, ctx.baseUrl, value || "(empty __VIEWSTATE field)");
    } else if (value) {
      const type = classifyEither(value);
      if (type) await record("hidden field", name, type, ctx.baseUrl, value);
    }
  }

  // 3) Cookies set by a single (anonymous) response — one fetch, not a crawl.
  try {
    const res = await probe(ctx.baseUrl, { timeoutMs: 10_000 });
    const setCookie = res.headers["set-cookie"];
    if (setCookie) {
      for (const chunk of splitSetCookie(setCookie)) {
        if (found >= MAX_FINDINGS) break;
        const eq = chunk.indexOf("=");
        if (eq < 0) continue;
        const name = chunk.slice(0, eq).trim();
        const value = chunk.slice(eq + 1).split(";")[0].trim();
        if (!name || !value) continue;
        const type = classifyEither(value);
        if (type) await record("cookie", name, type, ctx.baseUrl, value);
      }
    }
  } catch {
    // Cookie inspection is best-effort; a failed probe never aborts the scan.
  }

  await logLine(ctx.scanRunId, `[deser] done — ${found} serialized-object signature(s) detected (all CANDIDATE)`);
}
