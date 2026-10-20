import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

// Paths that never require authentication.
const PUBLIC_PATHS = ["/", "/login", "/register"];
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/register", "/api/health"];

// IP-rate-limited paths (anti brute-force / anti spam). Mapped to a short key
// label so counters are namespaced like `rl:register:<ip>` / `rl:login:<ip>`.
const RATE_LIMITED: Record<string, string> = {
  "/api/register": "register",
  "/api/auth/callback/credentials": "login",
};
const RL_LIMIT = 10; // requests
const RL_WINDOW_SEC = 15 * 60; // per 15 minutes

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

// Best-effort client IP: first hop of x-forwarded-for, then x-real-ip. The CDN /
// reverse proxy in front sets these; an attacker can spoof XFF but that only
// fragments their own counter, so it's an acceptable keying signal here.
function clientIp(req: { headers: Headers }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// Everything that isn't explicitly public (notably the (dashboard) route group:
// /targets, /scopes, /findings, /reports, /settings, ...) requires a session.
// Unauthenticated users are bounced to /login with a callbackUrl so they return
// to where they were headed.
export default auth(async (req) => {
  const { pathname, search } = req.nextUrl;

  // Rate-limit sensitive unauthenticated endpoints before anything else.
  const rlLabel = RATE_LIMITED[pathname];
  if (rlLabel) {
    const ip = clientIp(req);
    const { allowed, resetSec } = await rateLimit(
      `rl:${rlLabel}:${ip}`,
      RL_LIMIT,
      RL_WINDOW_SEC,
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(resetSec) } },
      );
    }
  }

  if (isPublic(pathname)) return NextResponse.next();

  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // auth() imports the Prisma adapter, so run middleware on the Node.js runtime
  // (stable in Next 16) rather than the edge.
  runtime: "nodejs",
  // Skip Next internals and static assets; run on everything else.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|otf|css|js|map|txt|xml|json)$).*)",
  ],
};
