/** Browser mutations must be same-origin. A browser derives Origin from the
 * real page origin but Host from the address it dialled, so a cross-site POST
 * always carries a foreign Origin with our own Host and is refused. Admitting
 * the addressed host alongside the configured public origin keeps every
 * published binding usable (loopback and a private interface at once) without
 * depending on the container's internal port.
 * Non-browser authenticated API clients may omit Origin. */
export function foreignOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (origin === null) return false;
  const allowed = new Set<string>();
  const add = (value: string) => {
    // A malformed value must neither widen the check nor refuse every mutation.
    try { allowed.add(new URL(value).origin); } catch { /* ignore */ }
  };
  if (process.env.AUTH_URL) add(process.env.AUTH_URL);
  // Host carries no scheme; AUTH_URL still pins the canonical public origin.
  const host = req.headers.get('host');
  if (host) for (const scheme of ['http://', 'https://']) add(scheme + host);
  return !allowed.has(origin);
}
