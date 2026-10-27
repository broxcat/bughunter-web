import { AsyncLocalStorage } from "node:async_hooks";
import { CredentialsSignin } from "next-auth";
import { rateLimit, type RateLimitResult } from "./rateLimit";
import { RATE_LIMIT_POLICIES, loginAccountKey } from "./abusePolicy";
import { resolveClientIp, isUsableClientIdentity } from "./clientIdentity";
import { logger } from "./logger";

type Denial = { status: 429 | 503; code: string; message: string; retrySec: number };
// Server-local context, never a client-supplied "already checked" header.
const context = new AsyncLocalStorage<{ denial?: Denial }>();
class LoginUnavailable extends CredentialsSignin { code = "temporarily_unavailable"; }
class LoginLimited extends CredentialsSignin { code = "rate_limited"; }

export async function guardCredentials(req: Request, email?: string): Promise<void> {
  const ip = resolveClientIp(req);
  const ipPolicy = RATE_LIMIT_POLICIES.loginIp;
  const accountPolicy = RATE_LIMIT_POLICIES.loginAccount;
  let results: RateLimitResult[];
  try {
    if (!isUsableClientIdentity(ip)) throw new Error("Trusted ingress identity unavailable");
    const accountKey = email ? loginAccountKey(email) : undefined;
    results = await Promise.all([
      rateLimit(`rl:login:ip:${ip.ip}`, ipPolicy.limit, ipPolicy.windowSec),
      ...(accountKey ? [rateLimit(accountKey, accountPolicy.limit, accountPolicy.windowSec)] : []),
    ]);
  } catch {
    // Missing server HMAC secret must not disable the account control.
    results = [{ status: "UNAVAILABLE" as const }];
  }
  const unavailable = results.some(result => result.status === "UNAVAILABLE");
  const blocked = results.filter(result => result.status === "BLOCKED");
  if (!unavailable && !blocked.length) return;
  const denial: Denial = unavailable
    ? { status: 503, code: "temporarily_unavailable", message: "Authentication temporarily unavailable. Please try again shortly.", retrySec: 30 }
    : { status: 429, code: "rate_limited", message: "Too many sign-in attempts. Please try again later.", retrySec: Math.max(...blocked.map(result => result.resetSec)) };
  const store = context.getStore();
  if (store) store.denial = denial;
  logger.warn({ operation: "login", code: denial.code, identitySource: ip.source }, "credential authentication refused by anti-abuse policy");
  throw unavailable ? new LoginUnavailable() : new LoginLimited();
}

/** Preserve Auth.js CSRF/cookie handling; expose actual HTTP 429/503 as well as
 * codes understood by next-auth/react. Server-side signIn is guarded too.
 */
export async function credentialsResponse(req: Request, handler: () => Promise<Response>): Promise<Response> {
  return context.run({}, async () => {
    const response = await handler();
    const denial = context.getStore()?.denial;
    if (!denial) return response;
    const url = new URL("/login", process.env.AUTH_URL || req.url);
    url.searchParams.set("error", "CredentialsSignin");
    url.searchParams.set("code", denial.code);
    const headers = new Headers(response.headers);
    headers.delete("location");
    headers.delete("content-length");
    headers.set("Content-Type", "application/json");
    headers.set("Cache-Control", "no-store");
    headers.set("Retry-After", String(denial.retrySec));
    return Response.json({ error: denial.message, url: url.toString() }, { status: denial.status, headers });
  });
}
