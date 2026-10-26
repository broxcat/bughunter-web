import { operatorOobBase } from "./oobPolicy";
import { recentReconCorpus } from "./corpus";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright-chromium";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { EMPTY_READINESS_FACTS, resolveHuntReadiness, type ReadinessFacts } from "@/lib/hunt/readiness";
import type { HuntPolicy } from "@/lib/hunt/policy";

function decode(cipher: string | null): string | null {
  if (!cipher) return null;
  try { return decryptSecret(cipher); } catch { return null; }
}
function cookies(cipher: string | null): Record<string, string> {
  try { const v = JSON.parse(decode(cipher) ?? "null"); return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, value]) => typeof value === "string" && value.length)) as Record<string, string> : {}; } catch { return {}; }
}
const isJwt = (v: string) => /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(v);
/** Metadata-only: no target HTTP, login, token echo, or second secret store. */
export async function loadReadinessFacts(targetId: string, observed: Partial<ReadinessFacts> = {}) {
  const rows = await prisma.targetCredential.findMany({ where: { targetId }, orderBy: { createdAt: "asc" } });
  const sessionTtl = (Number(process.env.TARGET_SESSION_TTL_MINUTES) || 20) * 60_000;
  const materials = rows.map(row => {
    const current = row.mode === "EMAIL_PASSWORD" && row.sessionRefreshedAt && Date.now() - row.sessionRefreshedAt.getTime() < sessionTtl ? cookies(row.sessionCookiesCipher) : cookies(row.cookiesCipher);
    const bearer = decode(row.headerCipher);
    const material = JSON.stringify({ cookies: Object.entries(current).sort(), bearer });
    return { id: row.id, label: row.label, mode: row.mode, purpose: row.purpose, ownedObjectUrl: row.ownedObjectUrl, hasSession: Object.keys(current).length > 0 || Boolean(bearer), hasCookies: Object.keys(current).length > 0, hasJwt: Boolean(bearer && isJwt(bearer)) || Object.values(current).some(isJwt), fingerprint: createHash("sha256").update(material).digest("hex") };
  });
  const usable = materials.filter(c => c.hasSession);
  const a = usable.find(c => c.purpose === "ACCOUNT_A");
  const b = usable.find(c => c.purpose === "ACCOUNT_B" && c.fingerprint !== a?.fingerprint);
  const independent = Boolean(a && b);
  const ownedReference = independent && Boolean(b?.ownedObjectUrl);
  const oobCallback = Boolean(operatorOobBase());
  const facts: ReadinessFacts = { ...EMPTY_READINESS_FACTS, ...observed, primaryCredential: usable.length > 0, secondCredential: independent, secondUserObjectReference: ownedReference, objectReference: Boolean(observed.objectReference) || ownedReference, authenticatedSession: usable.length > 0, sessionCookie: materials.some(c => c.hasCookies), jwt: materials.some(c => c.hasJwt) || Boolean(observed.jwt), oobCallback, browserContext: existsSync(chromium.executablePath()) };
  return { facts, credentials: materials.map(({ id, label, mode, purpose, hasSession, hasCookies, hasJwt }) => ({ id, label, mode, purpose, hasSession, hasCookies, hasJwt })) };
}
export async function loadHuntReadiness(targetId: string, policy: HuntPolicy, observed: Partial<ReadinessFacts> = {}) {
  const recon = await recentReconCorpus(targetId);
  const metadata = await loadReadinessFacts(targetId, { ...(recon ? { publicXssSurface: recon.publicXssSurface, discoveryComplete: true, xmlEndpoint: recon.surface.xml, oauthFlow: recon.surface.oauth, objectReference: recon.surface.objectReferences, stateChangingEndpoint: recon.surface.forms, jwt: recon.surface.jwt } : {}), ...observed });
  return { ...metadata, families: resolveHuntReadiness(policy, metadata.facts) };
}
