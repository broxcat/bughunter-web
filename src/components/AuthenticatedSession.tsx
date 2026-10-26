"use client";
import { SessionProvider, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { useEffect, type ReactNode } from "react";
function SessionContent({ children }: { children: ReactNode }) {
  const { status } = useSession();
  useEffect(() => { if (status === "unauthenticated") window.location.replace("/login"); }, [status]);
  if (status !== "authenticated") return <p role="status">Checking session…</p>;
  return children;
}
/** Observe Auth.js signout broadcasts and recheck sessions when another tab gains focus. */
export default function AuthenticatedSession({ session, children }: { session: Session | null; children: ReactNode }) {
  return <SessionProvider session={session} refetchOnWindowFocus><SessionContent>{children}</SessionContent></SessionProvider>;
}
