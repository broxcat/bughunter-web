import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Paths that never require authentication.
const PUBLIC_PATHS = ["/", "/login", "/register"];
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/register", "/api/health"];

/** Exact public allowlist. No legacy/internal exceptions (B2). */
export function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** B6: every API path segment (including dynamic [id] values) must be an
 * opaque identifier or a fixed route name. Encoded, dotted-only or oversized
 * segments are answered as not found before authentication or any handler. */
const API_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
export function apiPathRejected(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  return pathname.slice(5).split("/").some(segment => !API_SEGMENT.test(segment) || /^\.+$/.test(segment));
}

// Everything that isn't explicitly public (notably the (dashboard) route group:
// /targets, /scopes, /findings, /reports, /settings, ...) requires a session.
// Unauthenticated users are bounced to /login with a callbackUrl so they return
// to where they were headed.
export default auth(async (req) => {
  const { pathname, search } = req.nextUrl;

  // Anti-abuse checks live in the actual registration/credential handlers, so
  // proxy matcher exclusions and server-side signIn cannot bypass them.

  if (apiPathRejected(pathname)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (isPublic(pathname)) return NextResponse.next();

  if (!req.auth) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Proxy uses the Node.js runtime by default in Next 16.
  // B2: every /api path is matched unconditionally, so a dynamic segment that
  // happens to end in an asset extension (/api/x/abc.json) cannot skip it.
  // Pages skip Next internals and static assets only.
  matcher: [
    "/api/:path*",
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|otf|css|js|map|txt|xml|json)$).*)",
  ],
};
