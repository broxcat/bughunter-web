import { z } from "zod";
export const CREDENTIAL_PURPOSES = ["ACCOUNT_A", "ACCOUNT_B", "SESSION_COOKIE", "JWT", "OTHER"] as const;
export const credentialMetadataSchema = z.object({ purpose: z.enum(CREDENTIAL_PURPOSES).default("OTHER"), ownedObjectUrl: z.string().url().nullable().optional() });
export function ownedReferenceUrl(value: string | null | undefined, host: string): string | null {
  if (!value) return null;
  const u = new URL(value);
  if (!/^https?:$/.test(u.protocol) || u.host !== host || u.username || u.password || /(?:token|secret|password|session|authorization|cookie|code|key)/i.test([...u.searchParams.keys()].join(" "))) throw new Error("Use a same-host object URL without secrets or URL credentials");
  u.hash = ""; return u.toString();
}
