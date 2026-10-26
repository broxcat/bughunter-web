"use client";
import { SessionProvider, useSession } from "next-auth/react";
import { useEffect, type ReactNode } from "react";
function SessionContent({ children }: { children: ReactNode }) {
  const { status } = useSession();
  useEffect(() => { if (status === "unauthenticated") window.location.replace("/login"); }, [status]);
  if (status !== "authenticated") return <p role="status">Checking session…</p>;
  return children;
}
/** Check the current cookie on mount, then observe signout broadcasts and focus.
 * A server snapshot can become stale before another tab finishes hydration. */
export default function AuthenticatedSession({ children }: { children: ReactNode }) {
  return <SessionProvider refetchOnWindowFocus><SessionContent>{children}</SessionContent></SessionProvider>;
}
