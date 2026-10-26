import { operatorOobBase } from "./oobPolicy";
import { isHuntTechniqueApproved } from "@/lib/hunt/approvals";
import { executeBoundedTiming } from "./timingTechniques";
import { randomUUID } from "node:crypto";
import { credentialHeaders } from "@/server/credentials";
import { confirmXssSink } from "@/server/scanners/xssConfirm";
import { generateOobToken, checkOobHit } from "@/server/oob";
import { bodyHash, hasObjectMarker, safeResponseEvidence, sameResponse, usefulResponse } from "./evidence";
import type { HuntTechniqueDescriptor } from "@/lib/hunt/catalog";
import type { HuntObservation } from "@/lib/hunt/report";
import type { TechniqueContext } from "./runtime";

const dbError = /SQL syntax|SQLSTATE\[|syntax error at or near|unterminated quoted string|unclosed quotation mark|ORA-\d{4,}|MySqlException|PostgreSQL.*ERROR|sqlite.*(?:syntax|error)/i;
const fileKey = /^(file|filename|path|filepath|template|include|document|download|resource)$/i;
const urlKey = /^(url|uri|src|source|dest|destination|avatar|image|import|callback|webhook|feed|fetch|proxy|remote|redirect)$/i;
const signal = (title: string, summary: string, location?: string): HuntObservation => ({ title, summary, location, evidenceLevel: "SIGNAL", controls: [] });
const candidate = (title: string, summary: string, location?: string, controls: string[] = []): HuntObservation => ({ title, summary, location, evidenceLevel: "CANDIDATE", controls });
const withParam = (url: string, key: string, value: string) => { const u = new URL(url); u.searchParams.set(key, value); return u.toString(); };
const firstInput = (c: TechniqueContext) => c.corpus.queryInputs[0];
const auth = (c: TechniqueContext) => c.credentials[0] ? credentialHeaders(c.credentials[0]) : {};

function inventory(t: HuntTechniqueDescriptor, c: TechniqueContext): HuntObservation[] {
  const corpus = c.corpus;
  const entries: Record<string, () => HuntObservation[]> = {
    "auth.public-baseline": () => corpus.apiUrls.slice(0, 3).map(u => signal("Protected-route observation", "Authentication and content comparisons are needed; a route name is not a bypass.", u)),
    "idor.reference-discovery": () => corpus.objectUrls.filter(u => /\/\d+|[0-9a-f]{8}-[0-9a-f-]{27}/i.test(u)).slice(0, 3).map(u => signal("Observed numeric or opaque object reference", "Reference discovery alone does not prove unauthorized access.", u)),
    "idor.query-reference": () => corpus.queryInputs.filter(p => /(?:id|owner|user|account)/i.test(p.key)).slice(0, 3).map(p => signal("Observed object-reference query", "Compare only objects owned by the configured test identities.", p.url)),
    "idor.static-reference": () => corpus.objectUrls.filter(u => /\.(pdf|txt|json|csv)(?:\?|$)/i.test(u)).slice(0, 3).map(u => signal("Observed static object reference", "Opaque filenames still require authorization; no neighboring file is guessed.", u)),
    "xss.dom-source-sink": () => /innerHTML|outerHTML|document\.write|insertAdjacentHTML|postMessage/.test(corpus.raw.html) ? [signal("DOM source/sink observation", "A sink or source keyword alone does not demonstrate a controllable source-to-sink flow.")] : [],
    "csrf.form-inventory": () => corpus.forms.filter(f => f.method !== "GET").slice(0, 3).map(f => signal("State-changing form observed", `${f.method}; token marker ${f.tokenPresent ? "present" : "not observed"}; no action submitted.`, f.url)),
    "csrf.cookie-metadata": () => corpus.cookies.length ? [signal("Session cookie attributes observed", `${corpus.cookies.length} cookie metadata observations. SameSite restrictions and actual action impact need independent validation.`)] : [],
    "csrf.api-inventory": () => corpus.forms.filter(f => f.contentType === "application/json" || f.contentType === "unknown").slice(0, 3).map(f => signal("Script API action observed", `${f.method}; content type ${f.contentType}; browser simple-request feasibility is not assumed.`, f.url)),
    "cmdi.input-discovery": () => corpus.queryInputs.filter(p => /file|path|host|domain|command|tool|ip/i.test(p.key)).slice(0, 3).map(p => signal("Command-shaped input observed", "No command or induced delay executed; validation requires a separate confined test plan.", p.url)),
    "cmdi.error-signature": () => /(?:sh: .*not found|command not found|syntax error.*unexpected|not recognized as an internal)/i.test(corpus.raw.html) ? [signal("Existing command/parser error observed", "An error signature alone is not command injection.")] : [],
    "ssrf.url-input-discovery": () => corpus.queryInputs.filter(p => urlKey.test(p.key)).slice(0, 3).map(p => signal("URL-like input observed", "Only an explicitly configured operator-owned callback may be tested.", p.url)),
    "xxe.xml-inventory": () => corpus.xmlUrls.slice(0, 3).map(u => signal("XML response observed", "XML support is not external-entity expansion; no XML POST or file read performed.", u)),
    "xxe.document-review": () => /<!DOCTYPE|<!ENTITY|SAXParse|XML parsing/i.test(corpus.raw.html) ? [signal("XML parser/document metadata observed", "Passive DOCTYPE or parser messages are not proof of XXE.")] : [],
    "oauth.flow-inventory": () => corpus.oauthUrls.slice(0, 3).map(u => { const p = new URL(u).searchParams; return signal("OAuth/OIDC authorization flow observed", `State ${p.has("state") ? "present" : "not observed"}; PKCE ${p.has("code_challenge") ? "present" : "not observed"}. Absence alone is not a vulnerability.`, u); }),
    "oauth.flow-controls": () => corpus.oauthUrls.slice(0, 3).map(u => { const p = new URL(u).searchParams; return signal("OAuth response-type / redirect review", `Implicit response ${/token/.test(p.get("response_type") ?? "") ? "observed" : "not observed"}. No grant, consent or attacker redirect is initiated.`, u); }),
    "lfi.path-input-discovery": () => corpus.queryInputs.filter(p => fileKey.test(p.key)).slice(0, 3).map(p => signal("Path/file-like input observed", "Path traversal, local inclusion and remote inclusion are distinct; no system file is requested.", p.url)),
    "serialization.cookie-signature": () => c.credentials.flatMap(v => Object.values(v.cookies ?? {})).some(serialized) ? [signal("Serialized cookie format observed", "Format signature only; no token value or prefix recorded, no gadget executed.")] : [],
    "serialization.input-signature": () => corpus.queryInputs.some(p => serialized(p.value)) || /value=["'](?:rO0AB|\/wE|gAS|O:\d+:)/.test(corpus.raw.html) ? [signal("Serialized input format observed", "Passive signature is not proof of exploitable deserialization.")] : [],
    "business.race-inventory": () => corpus.forms.filter(f => /coupon|redeem|claim|vote|reserve|transfer/i.test(f.url)).slice(0, 3).map(f => signal("Limited-use action observed", "No burst, action replay or state mutation performed.", f.url)),
    "business.replay-review": () => /idempotency|retry|duplicate|single.use/i.test(corpus.raw.html) ? [signal("Retry/idempotency context observed", "A replay review lead, not a demonstrated limit overrun.")] : [],
    "business.critical-field-inventory": () => corpus.forms.filter(f => f.fields.some(k => /price|amount|total|quantity|role|plan|tier/i.test(k))).slice(0, 3).map(f => signal("Critical business fields observed", "Values are not changed; server-side trust and impact need explicit business-context validation.", f.url)),
    "business.value-review": () => /price|quantity|isAdmin|accessLevel|plan|checkout/i.test(corpus.raw.html) ? [signal("Business value-trust context observed", "Client-side names do not prove the server trusts or applies them.")] : [],
    "business.workflow-inventory": () => /step[\/-]?\d|checkout|verify|activate|confirm/i.test(corpus.raw.html) ? [signal("Multi-step workflow observed", "Final actions are not called or skipped automatically.")] : [],
    "business.transition-review": () => corpus.forms.filter(f => /step|confirm|complete|submit|activate/i.test(f.url)).slice(0, 3).map(f => signal("Workflow transition observed", "Ordering assumptions require manual domain review; no final action issued.", f.url)),
    "disclosure.header-inventory": () => (corpus.raw.pages ?? []).some(p => p.headers.server || p.headers["x-powered-by"]) ? [signal("Diagnostic technology headers observed", "Server banners and framework hints alone have no demonstrated security impact.")] : [],
  };
  return entries[t.id]?.() ?? [];
}
function serialized(v: string) { return /^(?:rO0AB|\/wE|gAS|O:\d+:|a:\d+:)/.test(v); }

async function xss(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const input = firstInput(c); if (!input) return [];
  if (t.id === "xss.browser-confirmation") {
    const result = await confirmXssSink(input.url, { sink: "controlled input", canaryId: `bh${randomUUID().replaceAll("-", "")}` });
    return result.confirmed ? [{ title: "Confirmed controlled XSS execution", summary: "An independently generated canary executed in the confined browser. No data extraction or stored write performed.", location: input.url, evidenceLevel: "CONFIRMED", controls: ["UNIQUE_EXECUTION_CANARY", "BROWSER_OBSERVED_DIALOG"], severity: "MEDIUM" }] : [];
  }
  const marker = `bh${randomUUID().replaceAll("-", "")}`;
  const r = await c.request(withParam(input.url, input.key, marker), { headers: auth(c) });
  return r.body.includes(marker) ? [candidate("Reflected input candidate", "A unique marker was reflected; encoding/context and independent browser execution are still required.", input.url, ["UNIQUE_CANARY"])] : [];
}

async function ssti(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const input = firstInput(c); if (!input) return [];
  if (t.id === "ssti.literal-control") {
    const marker = `bh${randomUUID().slice(0, 8)}`;
    const payload = `${marker}{{7*7}}${marker}`;
    const r = await c.request(withParam(input.url, input.key, payload), { headers: auth(c) });
    return r.body.includes(payload) ? [signal("Literal template reflection", "The expression is returned literally; no template evaluation is confirmed.", input.url)] : [];
  }
  for (const syntax of ["curly", "dollar"] as const) {
    const marker = `bh${randomUUID().slice(0, 8)}`;
    const expression = (n: number) => syntax === "curly" ? `{{${n}*${n}}}` : `\${${n}*${n}}`;
    const p1 = `${marker}${expression(7)}${marker}`, p2 = `${marker}${expression(8)}${marker}`;
    const inert = `${marker}{not-an-expression-7*7}${marker}`;
    const a = await c.request(withParam(input.url, input.key, p1), { headers: auth(c) });
    const b = await c.request(withParam(input.url, input.key, p2), { headers: auth(c) });
    const control = await c.request(withParam(input.url, input.key, inert), { headers: auth(c) });
    if (a.body.includes(`${marker}49${marker}`) && b.body.includes(`${marker}64${marker}`) && !a.body.includes(p1) && !b.body.includes(p2) && !control.body.includes(`${marker}49${marker}`)) return [{ title: "Confirmed arithmetic template evaluation", summary: "Two distinct controlled arithmetic results were evaluated; an inert control did not evaluate. No engine escape or command executed.", location: input.url, evidenceLevel: "CONFIRMED", controls: ["ARITHMETIC_49", "INDEPENDENT_ARITHMETIC_64", "INERT_CONTROL", "LITERAL_REFLECTION_REJECTED"], severity: "HIGH" }];
  }
  return [];
}

async function sql(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const input = firstInput(c); if (!input) return [];
  const key = `sql:${input.url}:${input.key}`;
  if (t.id === "sqli.error-differential") {
    const baseline = await c.request(input.url, { headers: auth(c) });
    const a = await c.request(withParam(input.url, input.key, input.value + "'"), { headers: auth(c) });
    const control = await c.request(withParam(input.url, input.key, input.value + "bhcontrol"), { headers: auth(c) });
    const repeated = await c.request(withParam(input.url, input.key, input.value + "'"), { headers: auth(c) });
    const valid = !dbError.test(baseline.body) && !dbError.test(control.body) && dbError.test(a.body) && dbError.test(repeated.body);
    c.cache.set(key, valid);
    return valid ? [{ ...candidate("Repeated database error differential", "SQL-like errors repeated independently of a matched inert control. No data extraction performed.", input.url, ["REPEATED_DB_SIGNATURE", "BASELINE_NO_SIGNATURE", "INERT_CONTROL_NO_SIGNATURE"]), evidenceLevel: "VALIDATED" }] : [];
  }
  if (!/^\d+$/.test(input.value)) return [];
  const baseline = await c.request(input.url, { headers: auth(c) });
  const positive = `${input.value} AND 1=1`, negative = `${input.value} AND 1=2`;
  const a = await c.request(withParam(input.url, input.key, positive), { headers: auth(c) });
  const b = await c.request(withParam(input.url, input.key, negative), { headers: auth(c) });
  const a2 = await c.request(withParam(input.url, input.key, positive), { headers: auth(c) });
  const b2 = await c.request(withParam(input.url, input.key, negative), { headers: auth(c) });
  const reproducible = sameResponse(baseline, a) && sameResponse(a, a2) && !a.error && !b.error && !b2.error && b.status === b2.status && bodyHash(b.body) === bodyHash(b2.body) && bodyHash(b.body) !== bodyHash(a.body) && !dbError.test(b.body);
  if (!reproducible) return [];
  const confirmed = c.cache.get(key) === true;
  return [{ title: confirmed ? "Confirmed controlled SQL differential" : "Boolean response candidate", summary: confirmed ? "Independent repeated database-error and read-only boolean techniques agree; only the original numeric filter was constrained, with no bulk data retrieval." : "Repeated boolean response difference alone may be application behavior; database execution remains unconfirmed.", location: input.url, evidenceLevel: confirmed ? "CONFIRMED" : "VALIDATED", controls: ["POSITIVE_MATCHES_BASELINE", "REPEATED_NEGATIVE_CONTROL", ...(confirmed ? ["INDEPENDENT_DB_ERROR_TECHNIQUE"] : [])], severity: "HIGH" }];
}

async function bola(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const a = c.credentials.find(v => v.purpose === "ACCOUNT_A"), b = c.credentials.find(v => v.purpose === "ACCOUNT_B");
  if (!a || !b?.ownedObjectUrl) return [];
  const url = b.ownedObjectUrl, cacheKey = `bola:${url}`;
  if (t.id === "bola.account-differential") {
    const owner = await c.request(url, { headers: credentialHeaders(b) });
    const other = await c.request(url, { headers: credentialHeaders(a) });
    const anonymous = await c.request(url);
    const valid = hasObjectMarker(owner) && sameResponse(owner, other) && !sameResponse(owner, anonymous);
    c.cache.set(cacheKey, { valid, owner });
    return valid ? [{ ...candidate("Cross-account object comparison candidate", "The other test identity received the owner-attested object's content. Independent repeated anonymous/account controls are still required.", url, ["EXPLICIT_OWNERSHIP_ATTESTATION", "TWO_TEST_IDENTITIES", "ANONYMOUS_CONTENT_CONTROL"]), evidenceLevel: "VALIDATED" }] : [];
  }
  const prior = c.cache.get(cacheKey) as { valid: boolean; owner: Awaited<ReturnType<TechniqueContext["request"]>> } | undefined;
  if (!prior?.valid) return [];
  const repeated = await c.request(url, { headers: credentialHeaders(a) });
  const anon = await c.request(url);
  return sameResponse(prior.owner, repeated) && !sameResponse(prior.owner, anon) ? [{ title: "Confirmed cross-account object access", summary: "A separate test account repeatedly read an owner-attested private object while the anonymous controls did not. Only response hashes and structural metadata are retained.", location: url, evidenceLevel: "CONFIRMED", controls: ["EXPLICIT_OWNERSHIP_ATTESTATION", "REPEATED_TWO_ACCOUNT_CONTENT_MATCH", "INDEPENDENT_ANONYMOUS_CONTROL", "JSON_OBJECT_MARKER"], evidence: safeResponseEvidence(repeated), severity: "HIGH" }] : [];
}

async function access(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const input = c.corpus.apiUrls[0]; if (!input || !c.credentials[0]) return [];
  const anonymous = await c.request(input);
  const authenticated = await c.request(input, { headers: auth(c) });
  if (t.id === "auth.read-differential") {
    c.cache.set(`auth:${input}`, { anonymous, authenticated });
    return usefulResponse(authenticated) && !sameResponse(anonymous, authenticated) ? [signal("Authenticated content baseline established", "An authenticated/anonymous difference establishes a control, not an authentication bypass.", input)] : [];
  }
  if (![401, 403].includes(anonymous.status) || !hasObjectMarker(authenticated)) return [];
  const variant = await c.request(input, { headers: { "X-Original-URL": new URL(input).pathname } });
  const control = await c.request(new URL(`/bh-not-found-${randomUUID()}`, c.ctx.baseUrl).toString());
  const repeated = await c.request(input, { headers: { "X-Original-URL": new URL(input).pathname } });
  if (sameResponse(variant, control)) return [];
  return sameResponse(authenticated, variant) && sameResponse(variant, repeated) ? [{ title: "Confirmed read-only routing authorization bypass", summary: "The routing-header response repeatedly matches the authenticated object while the ordinary anonymous request is denied and the catch-all control differs.", location: input, evidenceLevel: "CONFIRMED", controls: ["AUTHENTICATED_OBJECT_CONTROL", "ANONYMOUS_DENIAL", "CATCH_ALL_REJECTED", "REPEATED_CONTENT_MATCH"], severity: "HIGH" }] : [];
}

async function cors(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const url = c.corpus.apiUrls[0] ?? c.ctx.baseUrl;
  if (t.id === "cors.origin-matrix") {
    const host = new URL(url).hostname;
    const origins = ["https://bh-origin.example.invalid", "null", `https://${host}.example.invalid`, `https://bh-${host}`];
    const observed: HuntObservation[] = [];
    for (const origin of origins) {
      const r = await c.request(url, { headers: { Origin: origin } });
      if (r.headers["access-control-allow-origin"] === origin || r.headers["access-control-allow-origin"] === "*") observed.push(candidate("CORS configuration candidate", "Origin acceptance alone does not demonstrate exploitable sensitive cross-origin access.", url, ["ORIGIN_MATRIX"]));
    }
    return observed.slice(0, 3);
  }
  if (!c.credentials[0]) return [];
  const ordinary = await c.request(url, { headers: auth(c) });
  const crossed = await c.request(url, { headers: { ...auth(c), Origin: "https://bh-origin.example.invalid" } });
  const anonymous = await c.request(url);
  const repeated = await c.request(url, { headers: { ...auth(c), Origin: "https://bh-origin.example.invalid" } });
  if (crossed.headers["access-control-allow-origin"] !== "https://bh-origin.example.invalid" || crossed.headers["access-control-allow-credentials"] !== "true" || !sameResponse(ordinary, crossed) || !sameResponse(crossed, repeated) || sameResponse(ordinary, anonymous)) return [];
  return [{ ...candidate("Credentialed CORS content differential", "Authenticated content was reproduced under an arbitrary Origin, but actual cross-site cookie delivery and browser readability still require proof; no sensitive response data is stored.", url, ["AUTHENTICATED_CONTENT_CONTROL", "ANONYMOUS_CONTENT_DIFFERENCE", "REPEATED_ORIGIN_RESPONSE"]), evidenceLevel: "VALIDATED" }];
}

async function jwt(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const credential = c.credentials.find(v => (v.bearerToken && /^eyJ[^.]+\.eyJ[^.]+\.[^.]*$/.test(v.bearerToken)) || Object.values(v.cookies ?? {}).some(token => /^eyJ[^.]+\.eyJ[^.]+\.[^.]*$/.test(token)));
  const cookieName = Object.keys(credential?.cookies ?? {}).find(name => /^eyJ[^.]+\.eyJ[^.]+\.[^.]*$/.test(credential!.cookies![name]));
  const token = credential?.bearerToken ?? (cookieName ? credential?.cookies?.[cookieName] : undefined);
  if (!token) return [];
  const parts = token.split(".");
  if (t.id === "jwt.claims-audit") {
    try { const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()); const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()); return [signal("JWT validation metadata observed", `Algorithm ${typeof header.alg === "string" && /^[A-Z0-9-]{1,12}$/i.test(header.alg) ? header.alg : "other"}; expiry ${typeof payload.exp === "number" ? "present" : "not present"}. Claim values, token and signing material are not stored.`)]; } catch { return []; }
  }
  const url = credential?.ownedObjectUrl ?? c.corpus.apiUrls[0]; if (!url || !credential) return [];
  const valid = await c.request(url, { headers: credentialHeaders(credential) });
  const anonymous = await c.request(url);
  if (!hasObjectMarker(valid) || !usefulResponse(valid) || sameResponse(valid, anonymous)) return [];
  const corrupt = (ch: string) => `${parts[0]}.${parts[1]}.${ch}${parts[2].slice(1)}`;
  const forgedHeaders = (value: string) => cookieName ? credentialHeaders({ ...credential, bearerToken: undefined, cookies: { ...credential.cookies, [cookieName]: value } }) : { Authorization: `Bearer ${value}` };
  const a = await c.request(url, { headers: forgedHeaders(corrupt(parts[2][0] === "A" ? "B" : "A")) });
  const b = await c.request(url, { headers: forgedHeaders(corrupt(parts[2][0] === "C" ? "D" : "C")) });
  return sameResponse(valid, a) && sameResponse(a, b) ? [{ title: "Confirmed JWT signature validation failure", summary: "Two independently corrupted signatures retained access to the authenticated JSON object while anonymous access did not. No identity claim was changed or signing secret recovered.", location: url, evidenceLevel: "CONFIRMED", controls: ["VALID_TOKEN_OBJECT_CONTROL", "ANONYMOUS_CONTROL", "TWO_INVALID_SIGNATURE_CONTROLS"], severity: "HIGH" }] : [];
}

async function ssrf(c: TechniqueContext): Promise<HuntObservation[]> {
  const input = c.corpus.queryInputs.find(p => urlKey.test(p.key));
  const configured = operatorOobBase(); if (!input || !configured) return [];
  const attempts = [generateOobToken(), generateOobToken()];
  for (const attempt of attempts) {
    const callback = new URL(attempt.callbackUrl);
    if (callback.origin !== configured.origin || !callback.pathname.startsWith(configured.pathname.replace(/\/$/, "") + "/oob/")) return [];
    await c.request(withParam(input.url, input.key, callback.toString()), { headers: auth(c) });
  }
  await new Promise(resolve => setTimeout(resolve, Math.min(8000, c.remainingMs())));
  const hits = await Promise.all(attempts.map(a => checkOobHit(a.token)));
  return hits.every(Boolean) ? [{ ...candidate("Repeated controlled server-side callback", "Two operator-owned callback tokens correlated. This proves a server-side fetch, not permission to access arbitrary LAN/cloud resources or broader SSRF impact.", input.url, ["TWO_UNIQUE_OOB_TOKENS", "OPERATOR_OWNED_DESTINATION", "DATABASE_CALLBACK_CORRELATION"]), evidenceLevel: "VALIDATED" }] : [candidate("Blind SSRF input candidate", "No independent callback proof within the bounded wait; no internal or metadata address was contacted.", input.url)];
}

async function pathError(c: TechniqueContext): Promise<HuntObservation[]> {
  const input = c.corpus.queryInputs.find(p => fileKey.test(p.key)); if (!input) return [];
  const baseline = await c.request(input.url, { headers: auth(c) });
  const value = `bh_missing_${randomUUID()}.txt`;
  const r = await c.request(withParam(input.url, input.key, value), { headers: auth(c) });
  const pattern = /FileNotFound|No such file|failed to open stream|include\(\)|open_basedir/i;
  return !pattern.test(baseline.body) && pattern.test(r.body) ? [candidate("Path handling differential candidate", "A harmless nonexistent filename caused a path error; no traversal, local-file inclusion or remote inclusion is confirmed.", input.url, ["BASELINE_CONTROL", "NONEXISTENT_BENIGN_FILENAME"])] : [];
}
async function gitHead(c: TechniqueContext): Promise<HuntObservation[]> {
  const url = new URL("/.git/HEAD", c.ctx.baseUrl).toString();
  const a = await c.request(url), control = await c.request(new URL(`/bh-not-found-${randomUUID()}`, c.ctx.baseUrl).toString()), repeated = await c.request(url);
  return a.status === 200 && /^ref: refs\/heads\/[A-Za-z0-9._/-]+\s*$/.test(a.body) && a.body === repeated.body && a.body !== control.body ? [{ title: "Confirmed Git HEAD exposure", summary: "The minimal non-secret Git HEAD marker repeated and differed from the catch-all. No repository/configuration/credential dump was retrieved.", location: url, evidenceLevel: "CONFIRMED", controls: ["GIT_HEAD_STRUCTURAL_MARKER", "INDEPENDENT_REPEAT", "CATCH_ALL_CONTROL"], severity: "LOW" }] : [];
}
export async function executeHuntTechnique(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  if (((t.requiresApproval || ["STATE_CHANGING", "HIGH_RISK"].includes(t.risk)) && !isHuntTechniqueApproved(t.id, c.approvedTechniques)) || t.implementation !== "IMPLEMENTED") throw new Error("UNSUPPORTED_TECHNIQUE");
  if (/^(sqli|cmdi)\.timing-(screen|confirm)$/.test(t.id)) return executeBoundedTiming(t, c);
  if (["xss.reflection", "xss.browser-confirmation"].includes(t.id)) return xss(t, c);
  if (t.id.startsWith("sqli.")) return sql(t, c);
  if (t.id.startsWith("ssti.")) return ssti(t, c);
  if (t.id.startsWith("bola.")) return bola(t, c);
  if (["auth.read-differential", "auth.routing-control"].includes(t.id)) return access(t, c);
  if (t.id.startsWith("cors.")) return cors(t, c);
  if (t.id.startsWith("jwt.")) return jwt(t, c);
  if (t.id === "ssrf.controlled-oob") return ssrf(c);
  if (t.id === "lfi.path-error-differential") return pathError(c);
  if (t.id === "disclosure.git-head") return gitHead(c);
  return inventory(t, c);
}
