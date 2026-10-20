// IDOR candidate scanner (web2-vuln-classes SKILL §1).
//
// IDOR is the #1 paid web2 class but the SKILL is explicit: confirming it "needs
// two sessions" (A=attacker, B=victim) to prove cross-tenant access. This scanner
// does NOT have loaded credentials, so it never claims a confirmed IDOR — that
// would be a theoretical finding. Instead it surfaces id-like endpoints as INFO
// *candidates*, each tagged with its IDOR variant and the exact two-session test
// plan (the Q8 identity checks) a human must run to confirm. A light numeric
// neighbor probe (id ±1) adds a weak signal only.

import { probe } from "./http";
import { isLikelyUserParam } from "./paramFilter";
import { discoverCorpus } from "./discovery";
import { logLine, recordFinding, type ScanContext } from "./context";
import { resolveActiveBrain } from "@/server/brain";

const MAX_CANDIDATES = 15;

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Query keys that commonly carry a direct object reference.
const ID_PARAM_RE =
  /(^|_)(id|uid|user|account|order|invoice|doc|document|report|file|ticket|msg|message)s?(_?id)?$/i;

const TWO_SESSION_PLAN =
  "Confirm with two sessions (Q8 identity check): " +
  "1) log in as user A, note the id; 2) replay A's request with B's id; " +
  "3) retry with NO auth header; 4) retry under session B. It is a real IDOR " +
  "only if A reads/modifies B's data — if it also works with no auth it is " +
  "'missing auth', a different bug.";

interface Candidate {
  url: string;
  variant: string;
  note: string;
}

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

function classify(url: string): Candidate | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // V4/V3: an id-like query parameter.
  for (const key of parsed.searchParams.keys()) {
    if (ID_PARAM_RE.test(key) && isLikelyUserParam(url, key)) {
      return {
        url,
        variant: "V4 parameter-based (?" + key + "=)",
        note: `Query parameter "${key}" looks like a direct object reference.`,
      };
    }
  }
  // V2: UUID in the path or query.
  if (UUID_RE.test(url)) {
    return {
      url,
      variant: "V2 UUID swap",
      note: "A UUID object reference — enumerate another user's UUID to test.",
    };
  }
  // V1: numeric id path segment.
  if (/\/\d{1,}(?:\/|$|\?)/.test(parsed.pathname)) {
    return {
      url,
      variant: "V1 numeric id swap",
      note: "A numeric id in the path — swap it for an adjacent id across sessions.",
    };
  }
  return null;
}

function neighborUrl(url: string): string | null {
  const m = url.match(/^(.*\/)(\d+)(\/?.*)$/);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n)) return null;
  return `${m[1]}${n + 1}${m[3]}`;
}

export async function runIdor(ctx: ScanContext): Promise<void> {
  await logLine(ctx.scanRunId, `[idor] enumerating id-like endpoints on ${ctx.baseUrl}`);

  const host = new URL(ctx.baseUrl).host;
  const corpus = await discoverCorpus(ctx);
  if (!corpus.html) {
    await logLine(ctx.scanRunId, `[idor] could not crawl ${ctx.baseUrl} — skipping`, "STDERR");
    return;
  }
  if (corpus.authenticated) {
    await logLine(ctx.scanRunId, `[idor] using authenticated crawl (${corpus.urls.length} URLs)`);
  }

  const urls = extractUrls(corpus.html, ctx.baseUrl, host);
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const c = classify(u);
    if (c && !seen.has(c.url)) {
      seen.add(c.url);
      candidates.push(c);
      if (candidates.length >= MAX_CANDIDATES) break;
    }
  }

  await logLine(
    ctx.scanRunId,
    `[idor] examined ${urls.length} crawled URL(s), found ${candidates.length} id-like candidate(s)`,
  );

  if (candidates.length === 0) {
    await logLine(
      ctx.scanRunId,
      `[idor] none of the ${urls.length} crawled URL(s) carry an id-like object reference — nothing to flag`,
    );
    return;
  }

  // Optional: let the active provider rank which candidate is most IDOR-prone.
  const brain = await resolveActiveBrain(ctx.userId).catch(() => null);
  let aiRanking = "";
  if (brain) {
    aiRanking = await brain
      .chat(
        "You are a bug-bounty assistant. Be terse.",
        "Rank these endpoints by IDOR likelihood and say why in one line each:\n" +
          candidates.map((c) => `- ${c.url} (${c.variant})`).join("\n"),
        { maxTokens: 400, temperature: 0.2 },
      )
      .catch(() => "");
  }

  for (const c of candidates) {
    let weakSignal = "";
    const neighbor = c.variant.startsWith("V1") ? neighborUrl(c.url) : null;
    if (neighbor) {
      const a = await probe(c.url, { timeoutMs: 10_000 });
      const b = await probe(neighbor, { timeoutMs: 10_000 });
      if (a.status === 200 && b.status === 200 && a.bodyLen !== b.bodyLen) {
        weakSignal =
          ` Weak signal: id neighbor ${neighbor} also returns 200 with a ` +
          `different body size (${a.bodyLen} vs ${b.bodyLen}) — worth the two-session test.`;
      }
    }
    await recordFinding(ctx, {
      title: `IDOR candidate (${c.variant})`,
      vulnClass: "IDOR",
      severity: "INFO",
      confidence: "CANDIDATE",
      location: c.url,
      description:
        `${c.note}${weakSignal}\n\n${TWO_SESSION_PLAN}\n\n` +
        "Recorded as an INFO candidate, not a confirmed finding: cross-tenant " +
        "access cannot be proven without two authenticated sessions.",
      evidence: aiRanking ? `AI ranking of candidates:\n${aiRanking}` : undefined,
    });
  }

  await logLine(ctx.scanRunId, "[idor] done");
}
