import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Paths that never require authentication.
const PUBLIC_PATHS = ["/", "/login", "/register"];
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/register"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

// Everything that isn't explicitly public (notably the (dashboard) route group:
// /targets, /scopes, /findings, /reports, /settings, ...) requires a session.
// Unauthenticated users are bounced to /login with a callbackUrl so they return
// to where they were headed.
export default auth((req) => {
  const { pathname, search } = req.nextUrl;

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
