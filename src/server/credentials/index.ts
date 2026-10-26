import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { normalizeCookies, sessionState } from "@/lib/targetAuth";
import type { TargetCredential } from "@prisma/client";

export interface DecryptedTargetCredential {
  purpose?: string;
  ownedObjectUrl?: string | null;
  validationUrl?: string | null;
  identityHash?: string | null;
  id: string;
  label: string;
  cookies?: Record<string, string>;
  bearerToken?: string;
}
/** Internal decoder for an explicit connection check; never returned to clients. */
export function decodeTargetCredential(row: TargetCredential): DecryptedTargetCredential | null {
  const cred: DecryptedTargetCredential = { id: row.id, label: row.label, purpose: row.purpose, ownedObjectUrl: row.ownedObjectUrl, validationUrl: row.validationUrl, identityHash: row.sessionIdentityHash };
  try {
    const cipher = row.mode === "EMAIL_PASSWORD" ? row.sessionCookiesCipher : row.cookiesCipher;
    if (cipher) cred.cookies = normalizeCookies(JSON.parse(decryptSecret(cipher)));
    if (row.headerCipher) cred.bearerToken = decryptSecret(row.headerCipher);
    return cred.cookies || cred.bearerToken ? cred : null;
  } catch { return null; }
}
/** Scans consume verified sessions only; never log in or expose stored secrets. */
export async function loadTargetCredentials(targetId: string): Promise<DecryptedTargetCredential[]> {
  const rows = await prisma.targetCredential.findMany({ where: { targetId }, orderBy: { createdAt: "asc" } });
  return rows.filter(row => sessionState(row) === "VALID").map(decodeTargetCredential).filter((c): c is DecryptedTargetCredential => c !== null);
}
export function credentialHeaders(cred: DecryptedTargetCredential): Record<string, string> {
  return { ...(cred.cookies ? { Cookie: Object.entries(cred.cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(cred.bearerToken ? { Authorization: `Bearer ${cred.bearerToken}` } : {}) };
}
/** Compatibility endpoint: an explicit check uses the same guarded login path. */
export async function refreshTargetCredential(targetId: string, credentialId: string): Promise<boolean> {
  const { testStoredConnection } = await import("./connection");
  return (await testStoredConnection(targetId, credentialId)).status === "VALID";
}
