import { z } from "zod";
export const SESSION_STATES = ["VALID", "INVALID", "EXPIRED", "UNKNOWN"] as const;
export type SessionState = typeof SESSION_STATES[number];
export const SESSION_TTL_MS = (Number(process.env.TARGET_SESSION_TTL_MINUTES) || 20) * 60_000;
export function sessionState(row: { sessionStatus?: string; sessionCheckedAt?: Date | string | null; sessionExpiresAt?: Date | string | null }, now = Date.now()): SessionState {
  if (row.sessionStatus === "INVALID" || row.sessionStatus === "EXPIRED") return row.sessionStatus;
  if (row.sessionStatus !== "VALID" || !row.sessionCheckedAt) return "UNKNOWN";
  const checked = new Date(row.sessionCheckedAt).getTime();
  const expires = row.sessionExpiresAt ? new Date(row.sessionExpiresAt).getTime() : checked + SESSION_TTL_MS;
  return !Number.isFinite(checked) || !Number.isFinite(expires) || checked > now ? "UNKNOWN" : now >= Math.min(expires, checked + SESSION_TTL_MS) ? "EXPIRED" : "VALID";
}
/** RFC cookie-pair input only, never Set-Cookie attributes or arbitrary headers. */
export function normalizeCookies(input: string | Record<string, string>): Record<string, string> {
  const entries = typeof input === "string" ? (() => {
    if (input.length > 8192 || /[\r\n\x00]/.test(input)) throw new Error("Invalid session cookie");
    return input.trim().replace(/^Cookie:\s*/i, "").split(";").filter(p => p.trim()).map(part => {
      const eq = part.indexOf("="); if (eq < 1) throw new Error("Invalid session cookie");
      return [part.slice(0, eq).trim(), part.slice(eq + 1).trim()];
    });
  })() : Object.entries(input);
  if (!entries.length || entries.length > 50) throw new Error("Invalid session cookie");
  const names = new Set<string>();
  for (const [name, value] of entries) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || /^(path|domain|expires|max-age|samesite|secure|httponly)$/i.test(name) || typeof value !== "string" || !/^[\x21-\x3a\x3c-\x7e]*$/.test(value) || names.has(name)) throw new Error("Invalid session cookie");
    names.add(name);
  }
  if (entries.reduce((n, [k, v]) => n + k.length + v.length + 2, 0) > 8192) throw new Error("Invalid session cookie");
  return Object.fromEntries(entries);
}
export const connectionInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("EMAIL_PASSWORD"), username: z.string().trim().min(1).max(320), password: z.string().min(1).max(1024) }),
  z.object({ mode: z.literal("COOKIES"), cookies: z.string().min(1).max(8192) }),
]);
export interface AuthenticationSummary { scopeValid: boolean; userAgentConfigured: boolean; publicReady: boolean; authenticatedReady: boolean }
export function readinessSummary(scopeValid: boolean, userAgentConfigured: boolean, authenticatedSession: boolean): AuthenticationSummary {
  return { scopeValid, userAgentConfigured, publicReady: scopeValid && userAgentConfigured, authenticatedReady: scopeValid && userAgentConfigured && authenticatedSession };
}
