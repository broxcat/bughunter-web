/** GET alone does not make a business action safe. Refuse action-shaped paths. */
export function isSafeReadUrl(value: string): boolean {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
    if (/\/(?:oauth2?|oidc)\/(?:authorize|authorization|token|callback)|\/(?:authorize|consent)(?:\/|$)/i.test(u.pathname) && (u.searchParams.has("client_id") || u.searchParams.has("response_type") || /token|callback|consent/i.test(u.pathname))) return false;
    const action = /(?:^|[\/_-])(logout|signout|sign-out|delete|remove|destroy|purge|drop|wipe|reset|activate|deactivate|register|signup|sign-up|purchase|checkout|pay|payment|charge|refund|withdraw|transfer|redeem|claim|apply|confirm|complete|submit|finalize|unsubscribe|cancel|execute|run|send|update|create|grant|revoke)(?:$|[\/_?.-])/i;
    return !action.test(decodeURIComponent(u.pathname)) && ![...u.searchParams].some(([k, v]) => /^(action|method|operation|command|cmd)$/i.test(k) && action.test(`/${v}`));
  } catch { return false; }
}
export function safeObservationUrl(value: string): string {
  try {
    const u = new URL(value); u.username = ""; u.password = ""; u.hash = "";
    if (/eyJ[A-Za-z0-9_-]+\./.test(u.pathname)) return `${u.origin}/[REDACTED]`;
    const segments = u.pathname.split("/");
    u.pathname = segments.map((segment, i) => /^(?:token|tokens|secret|password|session|sessions|code|callback)$/i.test(segments[i - 1] ?? "") || (segment.length > 48 && !/^[0-9a-f-]{36}$/i.test(segment)) ? "[REDACTED]" : segment).join("/");
    for (const k of [...u.searchParams.keys()]) {
      if (!/^[a-z_][a-z0-9_.[\]-]{0,63}$/i.test(k)) { u.searchParams.delete(k); u.searchParams.set("redacted_key", "[REDACTED]"); }
      else u.searchParams.set(k, "[REDACTED]");
    }
    return u.toString();
  } catch { return "[REDACTED URL]"; }
}
export function redactObservationText(value: string): string {
  const plain = (text: string): string => text
    .replace(/\bBearer\s+[A-Za-z0-9_.~+\/-]+=*/gi, "[REDACTED BEARER]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[REDACTED JWT]")
    .replace(/\b(?:authorization|proxy-authorization|cookies?|set-cookie|password|secret|token|(?:x[-_])?(?:csrf|xsrf)(?:[-_]?token)?|x[-_]api[-_]key|api[_ -]?key|access_token|refresh_token|session[_ -]?(?:id|token)|sid)["']?\s*[:=]\s*[^\r\n]+/gi, "[REDACTED CREDENTIAL]")
    .replace(/https?:\/\/[^\s<>"`]+/gi, url => safeObservationUrl(url));
  // When a summary is JSON, parse its structure instead of trying to match
  // quoted/escaped credential values with a text regex. No raw body ingestion.
  const sensitiveKey = /^(?:authorization|proxy-authorization|cookies?|set-cookie|password|secret|token|(?:x[-_])?(?:csrf|xsrf)(?:[-_]?token)?|x[-_]api[-_]key|api[_ -]?key|access_token|refresh_token|session[_ -]?(?:id|token)|sid|AUTH_SECRET|DATABASE_URL|REDIS_URL|CREDENTIALS_ENCRYPTION_KEY)$|cipher$/i;
  const scrub = (data: unknown, depth = 0): unknown => {
    if (depth > 16) return "[REDACTED NESTED DATA]";
    if (typeof data === "string") return plain(data);
    if (Array.isArray(data)) return data.map(item => scrub(item, depth + 1));
    if (data && typeof data === "object") return Object.fromEntries(Object.entries(data).map(([key, item]) => [key, sensitiveKey.test(key) ? "[REDACTED CREDENTIAL]" : scrub(item, depth + 1)]));
    return data;
  };
  try { const data: unknown = JSON.parse(value); if (data && typeof data === "object") return JSON.stringify(scrub(data)); } catch { /* Free text uses the existing line redaction boundary. */ }
  return plain(value);
}
