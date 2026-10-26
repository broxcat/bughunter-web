/** Ephemeral CSRF material for a discovered login form; never stored or logged. */
export function detectCsrf(html: string, cookies: Record<string, string>, observed: Record<string, string> = {}) {
  const sources = new Set<string>();
  const headers: Record<string, string> = {};
  const safe = (v: string | undefined) => v && v.length <= 4096 && !/[\r\n\x00]/.test(v) ? v : undefined;
  const attr = (tag: string, key: string) => new RegExp(`${key}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  for (const tag of html.match(/<(?:input|meta)\b[^>]*>/gi) ?? []) {
    const name = attr(tag, "name") ?? attr(tag, "id") ?? "";
    if (!/csrf|xsrf|requestverificationtoken/i.test(name)) continue;
    if (/^<input/i.test(tag)) sources.add("HIDDEN_INPUT");
    if (/^<meta/i.test(tag)) {
      sources.add("META"); const token = safe(attr(tag, "content")); if (token) headers["x-csrf-token"] = token;
    }
  }
  for (const [name, value] of Object.entries(cookies)) if (/csrf|xsrf/i.test(name)) {
    sources.add("COOKIE"); let token = value; try { token = decodeURIComponent(token); } catch { /* raw token */ }
    if (safe(token)) headers[/xsrf/i.test(name) ? "x-xsrf-token" : "x-csrftoken"] = token;
  }
  for (const [name, value] of Object.entries(observed)) if (/^x-(?:csrf-token|xsrf-token|csrftoken)$/i.test(name) && safe(value)) { sources.add("HEADER"); headers[name.toLowerCase()] = value; }
  return { sources: [...sources], headers };
}
