/** B1: browser mutations must be provably same-origin.
 *
 * - With AUTH_URL configured (required by the Docker deployment), its origin
 *   is the only admitted origin. The Host header is client-controlled (DNS
 *   rebinding, alternative bindings) and never widens the set.
 * - Without AUTH_URL (local development), only the origin actually addressed
 *   by this request is admitted.
 * - Fetch Metadata: a browser that reports a cross-site or same-site
 *   initiator is refused even if a matching Origin were forged by a plugin.
 * - A mutation without Origin (or with Origin: null) is refused. Every
 *   current browser sends Origin on POST/PUT/PATCH/DELETE; scripted clients
 *   must send `Origin: <AUTH_URL>` explicitly. */
function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch { return null; }
}

export function admittedOrigins(req: Request, env: Record<string, string | undefined> = process.env): Set<string> {
  const configured = originOf(env.AUTH_URL);
  if (configured) return new Set([configured]);
  const allowed = new Set<string>();
  const addressed = originOf(req.url);
  if (addressed) allowed.add(addressed);
  const host = req.headers.get('host');
  if (host && !addressed) for (const scheme of ['http://', 'https://']) { const value = originOf(scheme + host); if (value) allowed.add(value); }
  return allowed;
}

export function foreignOrigin(req: Request, env: Record<string, string | undefined> = process.env) {
  const site = req.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return true;
  const origin = req.headers.get('origin');
  if (origin === null || origin === 'null') return true;
  return !admittedOrigins(req, env).has(origin);
}
