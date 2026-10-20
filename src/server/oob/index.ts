// Out-of-band (OOB) interaction module — the stable contract the SSRF scanner
// imports. It never touches the HTTP server; it only (a) mints callback URLs
// that embed a per-attempt token and (b) checks the shared OobHit table for a
// matching callback. Confirmation is correlation-by-Postgres: the catcher
// (src/server/oob/server.ts) writes the row, the worker reads it here. No
// worker -> catcher HTTP is involved.
//
// REACHABILITY (the make-or-break point): the token embedded in `callbackUrl`
// is only useful if the SCANNED TARGET can reach the catcher at that URL. The
// base comes from OOB_PUBLIC_BASE_URL, which the operator MUST set to a
// target-reachable address of the host-published catcher port (8089). For the
// current Tailscale test target that is the host's tailnet IP, e.g.
// OOB_PUBLIC_BASE_URL=http://100.121.43.68:8089. If it is unset we still mint a
// syntactically valid URL (see FALLBACK_BASE) so callers don't crash, but that
// URL will NOT resolve from the target until the env var is set correctly.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Documented fallback used only when OOB_PUBLIC_BASE_URL is unset. It points at
// the catcher's own listen port on localhost; this works for a same-host sanity
// check but is NOT reachable from a remote scanned target. Always set
// OOB_PUBLIC_BASE_URL in any real deployment.
const FALLBACK_BASE = "http://127.0.0.1:8089";

function publicBase(): string {
  const configured = (process.env.OOB_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  return configured || FALLBACK_BASE;
}

/**
 * Mint a fresh, url-safe OOB token and the callback URL that embeds it.
 * The caller injects `callbackUrl` into an SSRF sink and persists `token`
 * (e.g. on Finding.oobToken) so a later {@link checkOobHit} can correlate.
 */
export function generateOobToken(): { token: string; callbackUrl: string } {
  // UUID v4 with dashes removed → 32 url-safe hex chars, globally unique.
  const token = randomUUID().replace(/-/g, "");
  const callbackUrl = `${publicBase()}/oob/${token}`;
  return { token, callbackUrl };
}

/**
 * Look for the EARLIEST interaction recorded for `token`. Returns the hit's
 * minimal shape, or null if the target never called back (no confirmation).
 * Reads the shared OobHit table written by the catcher — no network call.
 */
export async function checkOobHit(
  token: string,
): Promise<{ receivedAt: Date; sourceIp: string | null; method: string } | null> {
  const hit = await prisma.oobHit.findFirst({
    where: { token },
    orderBy: { receivedAt: "asc" },
  });

  if (!hit) return null;

  return {
    receivedAt: hit.receivedAt,
    sourceIp: hit.sourceIp,
    method: hit.method,
  };
}
