// XSS scanner (web2-vuln-classes SKILL §3).
//
// EPISTEMIC HONESTY is the whole point of this module. A marker reflected
// un-encoded in an HTTP response, or a dalfox "[POSSIBLE]" hit, is NOT proof the
// payload executes in a real browser — CSP, the injection context (attribute vs.
// text vs. JS string), and client-side sanitizers all decide that, and we run
// headless with no DOM. So every finding here is recorded at severity INFO with
// an explicit "NOT confirmed executed in a browser; verify manually" note. We
// never escalate above INFO: we have no execution evidence and will not pretend
// we do. recordFinding always creates an UNVALIDATED Finding — the gate is never
// bypassed.
//
// Two best-effort, bounded checks:
//   1) Reflected XSS — inject a unique canary into discovered/guessed params and
//      see if it comes back un-encoded. If dalfox is installed we additionally
//      run it per-URL (it's in the Docker image) and fold its hits in.
//   2) DOM XSS — fetch the root page and its same-origin scripts, grep for the
//      DOM sinks in SKILL §3, and surface sink locations as candidates.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe } from "./http";
import { logLine, recordFinding, type ScanContext } from "./context";
import { runCommand } from "./runCommand";
import { resolveActiveBrain } from "@/server/brain";

const MINUTE = 60_000;

// Bounds — this is a best-effort sweep, not an exhaustive fuzz.
const MAX_REFLECTED_URLS = 20;
const MAX_DALFOX_URLS = 15;
const MAX_JS_FILES = 8;
const MAX_DOM_FINDINGS = 20;

// Common parameter names worth probing on the base URL when the page itself
// exposes none. Reflected sinks most often hide behind search / message params.
const GUESS_PARAMS = [
  "q",
  "s",
  "search",
  "query",
  "keyword",
  "name",
  "lang",
  "page",
  "redirect",
  "url",
  "return",
  "callback",
  "msg",
  "message",
  "error",
  "q1",
];

// DOM sinks from SKILL §3 — a reflected/stored source reaching one of these in
// client JS is a DOM-XSS candidate a human must trace from source to sink.
const DOM_SINKS: ReadonlyArray<{ re: RegExp; sink: string }> = [
  { re: /\.innerHTML\s*=/g, sink: "innerHTML =" },
  { re: /\.outerHTML\s*=/g, sink: "outerHTML =" },
  { re: /document\.write(?:ln)?\s*\(/g, sink: "document.write()" },
  { re: /\beval\s*\(/g, sink: "eval()" },
  { re: /\bsetTimeout\s*\(\s*['"`]/g, sink: "setTimeout(string)" },
  { re: /\bsetInterval\s*\(\s*['"`]/g, sink: "setInterval(string)" },
  { re: /\.insertAdjacentHTML\s*\(/g, sink: "insertAdjacentHTML()" },
  { re: /\blocation\.(?:href|replace|assign)\s*[=(]/g, sink: "location sink" },
  { re: /new\s+Function\s*\(/g, sink: "new Function()" },
  { re: /\$\(.*\)\.html\s*\(/g, sink: "jQuery .html()" },
  {
    re: /addEventListener\s*\(\s*['"`]message['"`]/g,
    sink: 'addEventListener("message") (postMessage source)',
  },
];

const NOT_CONFIRMED_NOTE =
  "NOT confirmed executed in a browser; verify manually. A reflection in the " +
  "HTTP response does not prove execution — check the injection context (HTML " +
  "text vs. attribute vs. JS string), any Content-Security-Policy, and " +
  "client-side sanitization before claiming impact.";

interface ParamUrl {
  url: string;
  /** The parameter whose value carries the canary. */
  param: string;
}

/** Collect same-origin absolute URLs referenced by an HTML document. */
function extractUrls(html: string, baseUrl: string, host: string): string[] {
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
  for (const m of html.matchAll(/(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) {
    add(m[1]);
  }
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    add(m[0]);
  }
  return [...out];
}

/** Same-origin .js URLs referenced by the page (for DOM-sink grepping). */
function extractScripts(html: string, baseUrl: string, host: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const abs = new URL(m[1], baseUrl);
      if (abs.host === host && /\.js(?:$|\?)/i.test(abs.pathname + abs.search)) {
        out.add(abs.toString());
      }
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

/**
 * Build the list of (url, param) pairs to inject the canary into: every param
 * of every discovered URL that carries a query, plus the base URL fuzzed with a
 * handful of guessed param names when nothing else turns up.
 */
function buildReflectedTargets(urls: string[], baseUrl: string): ParamUrl[] {
  const targets: ParamUrl[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    for (const key of parsed.searchParams.keys()) {
      const dedupe = `${parsed.origin}${parsed.pathname}?${key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      targets.push({ url: u, param: key });
      if (targets.length >= MAX_REFLECTED_URLS) return targets;
    }
  }
  // Nothing parameterized discovered — fall back to guessed params on the base.
  if (targets.length === 0) {
    for (const key of GUESS_PARAMS) {
      targets.push({ url: baseUrl, param: key });
      if (targets.length >= MAX_REFLECTED_URLS) break;
    }
  }
  return targets;
}

/** Replace (or add) `param`'s value with `value` on `url`. */
function withParam(url: string, param: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(param, value);
  return u.toString();
}

async function runReflected(ctx: ScanContext): Promise<number> {
  const host = new URL(ctx.baseUrl).host;
  const root = await probe(ctx.baseUrl, { timeoutMs: 10_000 });
  if (root.error) {
    await logLine(
      ctx.scanRunId,
      `[xss] could not fetch ${ctx.baseUrl}: ${root.error}`,
      "STDERR",
    );
    return 0;
  }

  const urls = extractUrls(root.body, ctx.baseUrl, host);
  const targets = buildReflectedTargets(urls, ctx.baseUrl);
  await logLine(
    ctx.scanRunId,
    `[xss] reflected probe: ${targets.length} param target(s) from ${urls.length} same-origin URL(s)`,
  );

  let found = 0;
  for (const t of targets) {
    // A unique, grep-safe canary wrapped so an un-encoded reflection is obvious:
    // the leading '"> breaks out of a possible attribute, and <xssID> is a tag
    // that only survives verbatim if < and > were NOT entity-encoded.
    const id = `xss${Math.random().toString(36).slice(2, 10)}`;
    const canary = `'"><${id}>`;
    const url = withParam(t.url, t.param, canary);
    const res = await probe(url, { timeoutMs: 10_000 });
    if (res.error || !res.body) continue;

    const raw = res.body.includes(`<${id}>`);
    const encoded =
      res.body.includes(`&lt;${id}&gt;`) || res.body.includes(`%3C${id}%3E`);
    if (!raw) continue;

    const ctHeader = res.headers["content-type"] ?? "";
    const htmlish = /html/i.test(ctHeader) || ctHeader === "";
    found += 1;
    await recordFinding(ctx, {
      title: `Reflected XSS candidate — param "${t.param}" reflected un-encoded`,
      vulnClass: "XSS",
      severity: "INFO",
      confidence: "PROVEN",
      location: url,
      description:
        `The canary <${id}> injected into "${t.param}" came back in the ` +
        `response body with its angle brackets intact` +
        (encoded ? " (an encoded copy also appears elsewhere)" : "") +
        `. Content-Type: ${ctHeader || "(none)"}` +
        (htmlish ? "" : " — non-HTML type, execution is unlikely") +
        `.\n\n${NOT_CONFIRMED_NOTE}`,
      evidence:
        `GET ${url}\n` +
        `-> status ${res.status}, ${res.bodyLen} bytes, reflected marker "<${id}>" present un-encoded`,
    });
  }
  return found;
}

/**
 * Optional dalfox pass. runCommand spawns argv-only (no stdin), so we use
 * `dalfox url <target>` per candidate rather than pipe mode, writing results to
 * a temp file we read back. dalfox labels its own hits; we fold them in at INFO
 * and repeat the "not confirmed" note — a dalfox hit is a lead, not a proof.
 */
async function runDalfox(ctx: ScanContext, targets: ParamUrl[]): Promise<number> {
  const slice = targets.slice(0, MAX_DALFOX_URLS);
  if (slice.length === 0) return 0;

  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), "xss-dalfox-"));
  } catch {
    return 0;
  }

  let found = 0;
  let spawnFailed = false;
  try {
    for (let i = 0; i < slice.length; i += 1) {
      if (spawnFailed) break;
      const outFile = join(dir, `dalfox-${i}.txt`);
      const { code, timedOut } = await runCommand(
        "dalfox",
        [
          "url",
          slice[i].url,
          "--silence",
          "--no-color",
          "--worker",
          "20",
          "--timeout",
          "10",
          "--output",
          outFile,
        ],
        { scanRunId: ctx.scanRunId, timeoutMs: 3 * MINUTE },
      );
      // code === null means the process could not be spawned (dalfox not
      // installed) — stop trying rather than log the same ENOENT repeatedly.
      if (code === null && !timedOut) {
        spawnFailed = true;
        await logLine(
          ctx.scanRunId,
          "[xss] dalfox not available — skipping dalfox pass (reflected probe already ran)",
        );
        break;
      }
      const hits = await readFile(outFile, "utf8").catch(() => "");
      for (const line of hits.split("\n")) {
        const hit = line.trim();
        if (!hit) continue;
        found += 1;
        await recordFinding(ctx, {
          title: `Possible XSS (dalfox) on ${slice[i].param}`,
          vulnClass: "XSS",
          severity: "INFO",
          confidence: "CANDIDATE",
          location: slice[i].url,
          description:
            `dalfox reported a possible XSS hit. ${NOT_CONFIRMED_NOTE}`,
          evidence: `[POSSIBLE] ${hit}`,
        });
        if (found >= MAX_DOM_FINDINGS) break;
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return found;
}

async function runDomSinks(ctx: ScanContext): Promise<number> {
  const host = new URL(ctx.baseUrl).host;
  const root = await probe(ctx.baseUrl, { timeoutMs: 10_000 });
  if (root.error) return 0;

  const docs: Array<{ src: string; body: string }> = [
    { src: `${ctx.baseUrl} (inline)`, body: root.body },
  ];
  for (const js of extractScripts(root.body, ctx.baseUrl, host).slice(0, MAX_JS_FILES)) {
    const r = await probe(js, { timeoutMs: 10_000 });
    if (!r.error && r.body) docs.push({ src: js, body: r.body });
  }

  let found = 0;
  const seen = new Set<string>();
  for (const doc of docs) {
    for (const { re, sink } of DOM_SINKS) {
      re.lastIndex = 0;
      if (!re.test(doc.body)) continue;
      const key = `${doc.src}::${sink}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found += 1;
      await recordFinding(ctx, {
        title: `DOM XSS sink present: ${sink}`,
        vulnClass: "XSS",
        severity: "INFO",
        confidence: "CANDIDATE",
        location: doc.src,
        description:
          `The DOM sink ${sink} appears in client-side code. This is a ` +
          `candidate only: it is a real DOM XSS only if attacker-controlled ` +
          `input (URL fragment, query param, or an unchecked postMessage) ` +
          `reaches this sink. Trace source → sink by hand.\n\n${NOT_CONFIRMED_NOTE}`,
      });
      if (found >= MAX_DOM_FINDINGS) return found;
    }
  }
  return found;
}

export async function runXss(ctx: ScanContext): Promise<void> {
  await logLine(ctx.scanRunId, `[xss] scanning ${ctx.baseUrl} (reflected + DOM sinks)`);

  // Reflected probe (always runs — no external dependency).
  const reflected = await runReflected(ctx).catch(async (err) => {
    await logLine(
      ctx.scanRunId,
      `[xss] reflected probe errored: ${err instanceof Error ? err.message : String(err)}`,
      "STDERR",
    );
    return 0;
  });

  // Rebuild the target list for the optional dalfox pass (cheap, re-fetch root).
  let dalfox = 0;
  try {
    const host = new URL(ctx.baseUrl).host;
    const root = await probe(ctx.baseUrl, { timeoutMs: 10_000 });
    if (!root.error) {
      const targets = buildReflectedTargets(
        extractUrls(root.body, ctx.baseUrl, host),
        ctx.baseUrl,
      );
      dalfox = await runDalfox(ctx, targets);
    }
  } catch (err) {
    await logLine(
      ctx.scanRunId,
      `[xss] dalfox pass errored: ${err instanceof Error ? err.message : String(err)}`,
      "STDERR",
    );
  }

  const dom = await runDomSinks(ctx).catch(async (err) => {
    await logLine(
      ctx.scanRunId,
      `[xss] DOM-sink scan errored: ${err instanceof Error ? err.message : String(err)}`,
      "STDERR",
    );
    return 0;
  });

  // Optional: let the active provider dedupe/triage if one is configured. Purely
  // advisory — logged, never used to change severity. Degrades to nothing.
  if (reflected + dalfox + dom > 0) {
    const brain = await resolveActiveBrain(ctx.userId).catch(() => null);
    if (brain) {
      const triage = await brain
        .chat(
          "You are a bug-bounty assistant. Be terse. These XSS candidates are UNCONFIRMED (no browser execution proof).",
          `Reflected: ${reflected}, dalfox: ${dalfox}, DOM sinks: ${dom} candidate(s) on ${ctx.baseUrl}. ` +
            "In 2-3 lines, which is most worth manual browser verification and why?",
          { maxTokens: 300, temperature: 0.2 },
        )
        .catch(() => "");
      if (triage) {
        await logLine(ctx.scanRunId, `[xss] AI triage (advisory, not scored):\n${triage}`);
      }
    }
  }

  await logLine(
    ctx.scanRunId,
    `[xss] done — ${reflected} reflected, ${dalfox} dalfox, ${dom} DOM-sink candidate(s) (all INFO, unconfirmed)`,
  );
}
