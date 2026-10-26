/** Passive, bounded parsers. Never deserialize objects or evaluate user input. */
export function serializationFormat(value: string): string | null {
  if (value.length > 8192) return null;
  let text = value;
  try { text = decodeURIComponent(text); } catch { /* raw cookie */ }
  const php = /^(?:O:\d+:"[^"\r\n]{1,120}":\d+:\{|a:\d+:\{|s:\d+:"[^"\r\n]*";|[ibd]:[\d.-]+;|N;)/;
  if (php.test(text)) return "PHP serialization";
  if (!/^[A-Za-z0-9+/_=-]+$/.test(text)) return null;
  const bytes = Buffer.from(text, "base64");
  const hex = bytes.subarray(0, 12).toString("hex");
  if (hex.startsWith("aced0005")) return "Java serialization";
  if (hex.startsWith("0408") && bytes.length >= 4) return "Ruby Marshal";
  if (/^800[2-5]/.test(hex) && bytes.length >= 4 && bytes.at(-1) === 0x2e) return "Python pickle";
  if (hex.startsWith("ff01") && bytes.length >= 4) return ".NET ViewState";
  if (bytes.subarray(0, 14).toString("hex") === "0001000000ffffffff0100000000") return ".NET BinaryFormatter";
  if (php.test(bytes.toString("utf8"))) return "PHP serialization (base64)";
  return null;
}
export function databaseSignature(body: string): string | null {
  const patterns = [
    ["postgresql", /syntax error at or near|unterminated quoted string|PostgreSQL.*ERROR|PG::SyntaxError/i],
    ["mysql", /SQL syntax.*MySQL|MySqlException|mysqli?[_\s].*(?:error|exception)|You have an error in your SQL syntax/i],
    ["sqlite", /sqlite.*(?:syntax|error)|SQLiteException|near .+: syntax error/i],
    ["mssql", /unclosed quotation mark|SqlException|Incorrect syntax near/i],
    ["oracle", /ORA-\d{4,}/],
    ["sql-unknown", /SQLSTATE\[|SQL syntax/i],
  ] as const;
  return patterns.find(([, pattern]) => pattern.test(body))?.[0] ?? null;
}
export const referenceKey = /(?:^|[_.\[])(?:id|owner|user|account|document|object)(?:_?id)?(?:\]|$)/i;
export function objectReference(url: string): boolean {
  const u = new URL(url);
  return /\/(?:\d+|[a-f\d]{8}-[a-f\d-]{27,}|[a-f\d]{32,64})(?:\/|$)/i.test(u.pathname) || [...u.searchParams].some(([key, value]) => referenceKey.test(key) && value.length > 0);
}
export const criticalField = /(?:price|amount|total|quantity|qty|discount|coupon|currency|balance|credit|role|admin|permission|access.?level|plan|tier)/i;
export function oauthControls(url: string): string {
  const p = new URL(url).searchParams;
  let redirect = "missing";
  try { const u = new URL(p.get("redirect_uri") ?? ""); redirect = /^https?:$/.test(u.protocol) && !u.username && !u.password ? "HTTP(S)" : "non-HTTP or userinfo"; } catch { /* relative/invalid: review only */ }
  return `Redirect ${redirect}; state ${p.has("state") ? "present" : "not observed"}; PKCE ${p.get("code_challenge_method") === "S256" ? "S256" : p.has("code_challenge") ? "other" : "not observed"}; response ${/token/.test(p.get("response_type") ?? "") ? "implicit token" : "other"}; client identifier ${p.has("client_id") ? "present" : "missing"}. No flow initiated; presence does not prove validation.`;
}
