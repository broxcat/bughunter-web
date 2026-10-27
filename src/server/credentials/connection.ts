import { throwIfScanAborted } from "@/server/scanControl";
import { prisma } from "@/lib/prisma";
import { createHash, randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { SESSION_TTL_MS, type SessionState } from "@/lib/targetAuth";
import { assertExecutionUrl } from "@/server/execution";
import { probe, type ProbeResult } from "@/server/scanners/http";
import { isSafeReadUrl, safeObservationUrl } from "@/lib/observationSafety";
import { bodyHash } from "@/server/credentials/responseFingerprint";
import { decodeTargetCredential, credentialHeaders } from "./index";
import { acquireSessionCookies } from "./autoLogin";
import { withConnectionExecution } from "./guard";
import type { TargetCredential } from "@prisma/client";

export interface ConnectionResult { status: SessionState; checkedAt: string; credentialId: string; message: string }
const messages: Record<SessionState, string> = { VALID: "Connected — Session valid", INVALID: "Connection failed — Credentials rejected or session expired", EXPIRED: "Connection failed — Credentials rejected or session expired", UNKNOWN: "Connection could not be verified" };
const contentType = (r: ProbeResult) => (r.headers["content-type"] ?? "").split(";")[0];
function authenticatedContent(r: ProbeResult): boolean {
  if (r.error || r.status !== 200 || !r.body || /<input[^>]*type=["']password|"(?:error|errors)"\s*:|access denied|unauthorized/i.test(r.body)) return false;
  if (/json/i.test(contentType(r))) {
    try { const v = JSON.parse(r.body); return Boolean(v && !Array.isArray(v) && typeof v === "object" && (v.authenticated === true || v.user?.id || v.id || v.username)); } catch { return false; }
  }
  return /(?:href|action)=["'][^"']*(?:logout|signout|sign-out)|data-authenticated=["']true/i.test(r.body);
}
function anonymousDenied(r: ProbeResult): boolean {
  if (r.error) return false;
  return [401, 403].includes(r.status) || r.status >= 300 && r.status < 400 && /login|signin|sign-in/i.test(r.headers.location ?? "") || r.status === 200 && /<input[^>]*type=["']password/i.test(r.body);
}
function safeCandidates(baseUrl: string, candidates: string[]): string[] {
  return [...new Set(candidates)].filter(url => { try { assertExecutionUrl(url); return new URL(url).origin === new URL(baseUrl).origin && !new URL(url).search && isSafeReadUrl(url); } catch { return false; } });
}
/** Stable authenticated semantics AND an independent anonymous denial are required. */
export async function verifySession(baseUrl: string, headers: Record<string, string>, candidates: string[]) {
  let denied = false;
  const root = await probe(baseUrl, { headers, timeoutMs: 4000 });
  const links = [...root.body.matchAll(/(?:href|action)\s*=\s*["']([^"']+)["']/gi)].map(m => { try { return new URL(m[1], baseUrl).toString(); } catch { return ""; } });
  const defaults = ["/api/me", "/account", "/profile", "/dashboard", "/api/auth/session"].map(path => new URL(path, baseUrl).toString());
  const urls = safeCandidates(baseUrl, [...candidates, ...links.filter(u => /account|profile|dashboard|\/me\b|\/api\//i.test(u)), baseUrl, ...defaults]).slice(0, 6);
  for (const url of urls) {
    const anon = await probe(url, { timeoutMs: 4000 });
    if (!anonymousDenied(anon)) continue;
    const signed = await probe(url, { headers, timeoutMs: 4000 });
    if ([401, 403].includes(signed.status) || anonymousDenied(signed)) { denied = true; continue; }
    if (!authenticatedContent(signed)) continue;
    const repeated = await probe(url, { headers, timeoutMs: 4000 });
    if (authenticatedContent(repeated) && contentType(signed) === contentType(repeated) && bodyHash(signed.body) === bodyHash(repeated.body)) {
      let subject: string | undefined;
      try { const v = JSON.parse(signed.body); subject = String(v.user?.id ?? (/\/(?:me|profile|account|session)(?:\/|$)/i.test(new URL(url).pathname) ? v.id : "") ?? "") || undefined; } catch { /* HTML identity not inferred */ }
      return { valid: true, denied: false, url, subject, observedUrls: links };
    }
  }
  return { valid: false, denied, url: undefined, subject: undefined, observedUrls: links };
}
async function ownedObject(base: string, headers: Record<string, string>, urls: string[], subject?: string): Promise<string | undefined> {
  if (!subject) return;
  const candidates = safeCandidates(base, urls).filter(u => /\/(?:\d+|[\da-f]{8}-[\da-f-]{27,})(?:\?|$|\/)/i.test(u)).slice(0, 2);
  for (const url of candidates) {
    const r = await probe(url, { headers, timeoutMs: 4000 });
    if (!authenticatedContent(r)) continue;
    try { const v = JSON.parse(r.body); if (String(v.ownerId ?? v.owner_id ?? v.userId ?? v.user_id) === subject) return url; } catch { /* cannot attest ownership */ }
  }
}
async function checkRow(row: TargetCredential, login: boolean, allowLoginAction?: (url: string, detectedPasswordForm?: boolean, passwordField?: string) => void): Promise<ConnectionResult> {
  const target = await prisma.target.findUniqueOrThrow({ where: { id: row.targetId }, select: { host: true, scheme: true } });
  const base = `${target.scheme === "http" ? "http" : "https"}://${target.host}`;
  const checked = new Date();
  const checkId = randomUUID();
  const claim = await prisma.targetCredential.updateMany({ where: { id: row.id, sessionCheckId: row.sessionCheckId }, data: { sessionCheckId: checkId, sessionStatus: "UNKNOWN" } });
  if (!claim.count) return { status: "UNKNOWN", checkedAt: checked.toISOString(), credentialId: row.id, message: messages.UNKNOWN };
  let status: SessionState = "UNKNOWN", validationUrl: string | undefined;
  let cookies: Record<string, string> | undefined, expiresAt: Date | undefined = row.sessionExpiresAt ?? undefined, discoveredLogin: string | undefined;
  let discoveredOwned: string | undefined;
  let discoveredBearer: string | undefined;
  let identityHash: string | null = null;
  try {
    const candidates: string[] = row.validationUrl ? [row.validationUrl] : row.ownedObjectUrl ? [row.ownedObjectUrl] : [];
    let credential = decodeTargetCredential(row);
    if (login && row.mode === "EMAIL_PASSWORD") {
      if (!row.emailCipher || !row.passwordCipher) throw new Error("Missing credentials");
      const acquired = await acquireSessionCookies({ baseUrl: base, loginUrl: row.loginUrl ?? undefined, username: decryptSecret(row.emailCipher), password: decryptSecret(row.passwordCipher), allowLoginAction });
      if (acquired.rejected) status = "INVALID";
      else if (!acquired.error && (Object.keys(acquired.cookies).length || acquired.bearerToken)) {
        cookies = acquired.cookies; expiresAt = acquired.expiresAt; discoveredLogin = acquired.loginUrl;
        discoveredBearer = acquired.bearerToken;
        credential = { id: row.id, label: row.label, cookies, bearerToken: discoveredBearer };
        candidates.push(...acquired.candidateUrls ?? []);
      } else credential = null;
    }
    if (status !== "INVALID" && credential) {
      const headers = credentialHeaders(credential);
      const proof = await verifySession(base, headers, candidates);
      status = proof.valid ? "VALID" : proof.denied ? row.mode === "EMAIL_PASSWORD" ? "INVALID" : "EXPIRED" : "UNKNOWN";
      validationUrl = proof.url;
      if (proof.valid && proof.subject) identityHash = createHash("sha256").update(proof.subject).digest("hex");
      if (proof.valid) discoveredOwned = await ownedObject(base, headers, proof.observedUrls, proof.subject);
    }
  } catch { throwIfScanAborted(); status = "UNKNOWN"; }
  const saved = await prisma.targetCredential.updateMany({ where: { id: row.id, sessionCheckId: checkId }, data: {
    sessionStatus: status, sessionCheckedAt: checked,
    sessionIdentityHash: identityHash,
    sessionExpiresAt: status === "VALID" ? new Date(Math.min(expiresAt?.getTime() ?? Infinity, checked.getTime() + SESSION_TTL_MS)) : null,
    ...(validationUrl ? { validationUrl: safeObservationUrl(validationUrl).split("?")[0] } : {}),
    ...(discoveredLogin ? { loginUrl: discoveredLogin } : {}),
    ...(discoveredOwned ? { ownedObjectUrl: discoveredOwned } : {}),
    ...(row.mode === "EMAIL_PASSWORD" && login ? { headerCipher: status === "VALID" && discoveredBearer ? encryptSecret(discoveredBearer) : null } : {}),
    ...(row.mode === "EMAIL_PASSWORD" ? { sessionCookiesCipher: status === "VALID" && cookies ? encryptSecret(JSON.stringify(cookies)) : login ? null : row.sessionCookiesCipher, ...(status === "VALID" && cookies ? { sessionRefreshedAt: checked } : {}) } : {}),
  } });
  if (!saved.count) status = "UNKNOWN"; // A newer check wins; never restore stale material.
  return { status, checkedAt: checked.toISOString(), credentialId: row.id, message: messages[status] };
}
export async function testStoredConnection(targetId: string, credentialId: string, signal?: AbortSignal): Promise<ConnectionResult> {
  return withConnectionExecution(targetId, async guard => {
    const row = await prisma.targetCredential.findFirst({ where: { targetId, id: credentialId } });
    if (!row) throw new Error("CREDENTIAL_NOT_FOUND");
    return checkRow(row, true, guard.allowLoginAction);
  }, signal);
}
