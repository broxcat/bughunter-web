import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";

// Server-side loader for TARGET credentials — session cookies / bearer token
// FOR THE SCANNED TARGET (a bug-bounty program's app), NEVER the bughunter-web
// login. These let the BOLA/CSRF scanners authenticate as real test accounts on
// the target the user is authorized to test.
//
// COMPLIANCE CAVEAT: the operator is responsible for ensuring these test
// accounts — and their use by the scanners — comply with the target program's
// rules of engagement. bughunter-web stores them only to drive authenticated
// requests against an APPROVED scope.
//
// SECURITY INVARIANT (same as AiProviderConfig.apiKeyCipher): the ciphertext and
// the decrypted plaintext are NEVER returned to any client and NEVER logged.
// This module is server-only; keys are decrypted in-process at request time by
// the scanners that import it. The decrypted values here exist purely to build
// request headers for the target.

export interface DecryptedTargetCredential {
  id: string;
  label: string;
  cookies?: Record<string, string>; // session cookies for the TARGET
  bearerToken?: string; // Authorization: Bearer value for the TARGET
}

/**
 * Loads a target's credentials and decrypts them server-side (decryptSecret).
 *
 * Reads prisma.targetCredential for the targetId, decrypts cookiesCipher
 * (JSON.parse) / headerCipher via `decryptSecret`, and degrades gracefully: a
 * row whose decrypt or JSON.parse fails is skipped rather than throwing, so one
 * corrupt/key-rotated row never breaks an authenticated scan. A row that yields
 * neither cookies nor a bearer token is dropped.
 */
export async function loadTargetCredentials(
  targetId: string,
): Promise<DecryptedTargetCredential[]> {
  const rows = await prisma.targetCredential.findMany({
    where: { targetId },
    orderBy: { createdAt: "asc" },
  });

  const out: DecryptedTargetCredential[] = [];
  for (const row of rows) {
    const cred: DecryptedTargetCredential = { id: row.id, label: row.label };

    if (row.cookiesCipher) {
      try {
        const parsed: unknown = JSON.parse(decryptSecret(row.cookiesCipher));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const cookies: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === "string") cookies[k] = v;
          }
          if (Object.keys(cookies).length > 0) cred.cookies = cookies;
        }
      } catch {
        // Skip an undecryptable / malformed cookies blob; never throw.
      }
    }

    if (row.headerCipher) {
      try {
        const token = decryptSecret(row.headerCipher);
        if (token) cred.bearerToken = token;
      } catch {
        // Skip an undecryptable bearer token; never throw.
      }
    }

    if (cred.cookies || cred.bearerToken) out.push(cred);
  }

  return out;
}

/**
 * Turns a credential into request headers for the TARGET:
 *   cookies     -> "Cookie: k=v; k2=v2"
 *   bearerToken -> "Authorization: Bearer <token>"
 * Returns an empty object when the credential carries neither.
 */
export function credentialHeaders(
  cred: DecryptedTargetCredential,
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (cred.cookies) {
    const pairs = Object.entries(cred.cookies).map(([k, v]) => `${k}=${v}`);
    if (pairs.length > 0) headers["Cookie"] = pairs.join("; ");
  }

  if (cred.bearerToken) {
    headers["Authorization"] = `Bearer ${cred.bearerToken}`;
  }

  return headers;
}
