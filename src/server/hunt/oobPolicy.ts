/** Operator configuration is the only callback authority; never a loopback fallback. */
export function operatorOobBase(): URL | null {
  try {
    const u = new URL(process.env.OOB_PUBLIC_BASE_URL ?? "");
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash || /^(?:169\.254\.|0\.0\.0\.0$|metadata\.google\.internal$|\[?fe80:)/i.test(u.hostname)) return null;
    return u;
  } catch { return null; }
}
