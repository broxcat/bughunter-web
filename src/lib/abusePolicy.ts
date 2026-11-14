import { createHmac } from "node:crypto";

export const RATE_LIMIT_POLICIES = {
  loginIp: { limit: 20, windowSec: 15 * 60 },
  loginAccount: { limit: 8, windowSec: 15 * 60 },
  scanUser: { limit: 20, windowSec: 60 * 60 },
} as const;

export const publicRegistrationEnabled = () => process.env.ALLOW_PUBLIC_REGISTRATION === "true";
export const normalizeLogin = (email: string) => email.trim().toLowerCase();

export function loginAccountKey(email: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret?.trim()) throw new Error("Authentication secret unavailable");
  return `rl:login:account:${createHmac("sha256", secret).update(`login-account\0${normalizeLogin(email)}`).digest("hex")}`;
}
