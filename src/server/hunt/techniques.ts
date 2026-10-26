import { payloadVariant, queryProbeUrl, corsOrigins, sstiVariants } from "@/lib/hunt/payloads";
import { setTimeout as wait } from "node:timers/promises";
import { currentTargetExecution } from "@/server/execution";
import { serializationFormat, databaseSignature, referenceKey, criticalField, oauthControls } from "./fingerprints";
import { operatorOobBase } from "./oobPolicy";
import { isHuntTechniqueApproved } from "@/lib/hunt/approvals";
import { executeBoundedTiming } from "./timingTechniques";
import { randomUUID } from "node:crypto";
import { credentialHeaders } from "@/server/credentials";
import { confirmXssSink } from "@/server/scanners/xssConfirm";
import { generateOobToken, checkOobHit } from "@/server/oob";
import { bodyHash, comparableResponse, deniedObjectControl, responseType, hasObjectMarker, safeResponseEvidence, sameResponse, usefulResponse } from "./evidence";
import type { HuntTechniqueDescriptor } from "@/lib/hunt/catalog";
import type { HuntObservation } from "@/lib/hunt/report";
import type { TechniqueContext } from "./runtime";

const dbError = { test: (body: string) => databaseSignature(body) !== null };
const fileKey = /^(file|filename|path|filepath|template|include|document|download|resource)$/i;
const urlKey = /^(url|uri|src|source|dest|destination|avatar|image|import|callback|webhook|feed|fetch|proxy|remote|redirect)$/i;
const signal = (title: string, summary: string, location?: string): HuntObservation => ({ title, summary, location, evidenceLevel: "SIGNAL", controls: [] });
const candidate = (title: string, summary: string, location?: string, controls: string[] = []): HuntObservation => ({ title, summary, location, evidenceLevel: "CANDIDATE", controls });
const withParam = queryProbeUrl;
const firstInput = (c: TechniqueContext) => c.corpus.queryInputs[0];
const sqlInputs = (c: TechniqueContext) => [...c.corpus.queryInputs].sort((a, b) => Number(/^\d+$/.test(b.value)) - Number(/^\d+$/.test(a.value))).slice(0, 2);
const outcome = (title: string, summary: string, location: string, evidenceLevel: "FALSE_POSITIVE" | "INCONCLUSIVE"): HuntObservation => ({ title, summary, location, evidenceLevel, controls: [] });
const auth = (c: TechniqueContext) => c.credentials[0] ? credentialHeaders(c.credentials[0]) : {};

function inventory(t: HuntTechniqueDescriptor, c: TechniqueContext): HuntObservation[] {
  const corpus = c.corpus;
  const entries: Record<string, () => HuntObservation[]> = {
    "auth.public-baseline": () => corpus.apiUrls.slice(0, 3).map(u => signal("Protected-route observation", "Authentication and content comparisons are needed; a route name is not a bypass.", u)),
    "idor.reference-discovery": () => corpus.objectUrls.slice(0, 3).map(u => signal("Observed numeric, UUID, hashed or nested object reference", "Reference discovery alone does not prove unauthorized access.", u)),
    "idor.query-reference": () => corpus.queryInputs.filter(p => referenceKey.test(p.key)).slice(0, 3).map(p => signal("Observed object-reference query", "Compare only objects owned by the configured test identities.", p.url)),
    "idor.static-reference": () => corpus.objectUrls.filter(u => /\.(pdf|txt|json|csv)(?:\?|$)/i.test(u)).slice(0, 3).map(u => signal("Observed static object reference", "Opaque filenames still require authorization; no neighboring file is guessed.", u)),
    "xss.dom-source-sink": () => /innerHTML|outerHTML|document\.write|insertAdjacentHTML|postMessage/.test(corpus.raw.html) ? [signal("DOM source/sink observation", "A sink or source keyword alone does not demonstrate a controllable source-to-sink flow.")] : [],
    "csrf.form-inventory": () => corpus.forms.filter(f => f.method !== "GET" || /delete|update|transfer|pay|redeem|confirm|logout/i.test(f.url)).slice(0, 3).map(f => signal("State-changing form observed", `${f.method}; content type ${f.contentType}; token marker ${f.tokenPresent ? "present" : "not observed"}; no action submitted. Token presence, SameSite, Origin/Referer enforcement and method/content-type transformations require a disposable action fixture.`, f.url)),
    "csrf.cookie-metadata": () => corpus.cookies.length ? [signal("Session cookie attributes observed", `${corpus.cookies.length} cookie metadata observations. SameSite restrictions and actual action impact need independent validation.`)] : [],
    "csrf.api-inventory": () => corpus.forms.filter(f => f.contentType === "application/json" || f.contentType === "unknown").slice(0, 3).map(f => signal("Script API action observed", `${f.method}; content type ${f.contentType}; browser simple-request feasibility is not assumed.`, f.url)),
    "cmdi.input-discovery": () => corpus.queryInputs.filter(p => /file|path|host|domain|command|tool|ip/i.test(p.key)).slice(0, 3).map(p => signal("Command-shaped input observed", "No command or induced delay executed; validation requires a separate confined test plan.", p.url)),
    "cmdi.error-signature": () => /(?:sh: .*not found|command not found|syntax error.*unexpected|not recognized as an internal)/i.test(corpus.raw.html) ? [signal("Existing command/parser error observed", "An error signature alone is not command injection.")] : [],
    "ssrf.url-input-discovery": () => corpus.queryInputs.filter(p => urlKey.test(p.key)).slice(0, 3).map(p => signal("URL-like input observed", "Only an explicitly configured operator-owned callback may be tested.", p.url)),
    "xxe.xml-inventory": () => corpus.xmlUrls.slice(0, 3).map(u => signal("XML response observed", "XML support is not external-entity expansion; no XML POST or file read performed.", u)),
    "xxe.document-review": () => /<!DOCTYPE|<!ENTITY|SAXParse|XML parsing|<xi:include|www\.w3\.org\/2001\/XInclude/i.test(corpus.raw.html) ? [{ ...signal("XML parser/document metadata observed", "DOCTYPE, entity, XInclude and parser messages are passive signals; neither XML support nor a declared entity proves external expansion."), evidence: { doctype: /<!DOCTYPE/i.test(corpus.raw.html), entity: /<!ENTITY/i.test(corpus.raw.html), xinclude: /<xi:include|www\.w3\.org\/2001\/XInclude/i.test(corpus.raw.html) } }] : [],
    "oauth.flow-inventory": () => corpus.oauthUrls.slice(0, 3).map(u => { const p = new URL(u).searchParams; return signal("OAuth/OIDC authorization flow observed", `State ${p.has("state") ? "present" : "not observed"}; PKCE ${p.has("code_challenge") ? "present" : "not observed"}. Absence alone is not a vulnerability.`, u); }),
    "oauth.flow-controls": () => corpus.oauthUrls.slice(0, 3).map(u => ({ ...signal("OAuth response-type / redirect review", oauthControls(u), u), evidence: { referrerPolicyObserved: (corpus.raw.pages ?? []).some(p => Boolean(p.headers["referrer-policy"])), fragmentTokenMarker: /#(?:access_token|id_token)=/i.test(corpus.raw.html), codeExchangeNotTested: true } })),
    "lfi.path-input-discovery": () => corpus.queryInputs.filter(p => fileKey.test(p.key)).slice(0, 3).map(p => signal("Path/file-like input observed", "Path traversal, local inclusion and remote inclusion are distinct; no system file is requested.", p.url)),
    "serialization.cookie-signature": () => [...new Set(c.credentials.flatMap(v => Object.values(v.cookies ?? {})).map(serializationFormat).filter(Boolean))].map(format => signal("Serialized cookie format observed", `${format}; passive format evidence only; no token value/prefix recorded or gadget executed.`)),
    "serialization.input-signature": () => [...new Set([...corpus.queryInputs.map(p => p.value), ...[...corpus.raw.html.matchAll(/value=["']([^"']{1,8192})["']/g)].map(m => m[1])].map(serializationFormat).filter(Boolean))].slice(0, 3).map(format => signal("Serialized input format observed", `${format}; passive signature is not proof of exploitable deserialization.`)),
    "business.race-inventory": () => corpus.forms.filter(f => /coupon|redeem|claim|vote|reserve|transfer|withdraw|refund|credit|discount/i.test(f.url)).slice(0, 3).map(f => signal("Limited-use action observed", "No burst, action replay or state mutation performed.", f.url)),
    "business.replay-review": () => /idempotency|retry|duplicate|single.use/i.test(corpus.raw.html) ? [signal("Retry/idempotency context observed", "A replay review lead, not a demonstrated limit overrun.")] : [],
    "business.critical-field-inventory": () => corpus.forms.filter(f => f.fields.some(k => criticalField.test(k))).slice(0, 3).map(f => signal("Critical business fields observed", "Values are not changed; server-side trust and impact need explicit business-context validation.", f.url)),
    "business.value-review": () => criticalField.test(corpus.raw.html) ? [signal("Business value-trust context observed", "Client-side names do not prove the server trusts or applies them.")] : [],
    "business.workflow-inventory": () => /step[\/-]?\d|checkout|verify|activate|confirm/i.test(corpus.raw.html) ? [signal("Multi-step workflow observed", "Final actions are not called or skipped automatically.")] : [],
    "business.transition-review": () => corpus.forms.filter(f => /step|confirm|complete|submit|activate/i.test(f.url)).slice(0, 3).map(f => signal("Workflow transition observed", "Ordering assumptions require manual domain review; no final action issued.", f.url)),
    "disclosure.header-inventory": () => (corpus.raw.pages ?? []).some(p => p.headers.server || p.headers["x-powered-by"]) ? [signal("Diagnostic technology headers observed", "Server banners and framework hints alone have no demonstrated security impact.")] : [],
  };
  return entries[t.id]?.() ?? [];
}

async function xss(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const input = firstInput(c); if (!input) return [];
  if (t.id === "xss.browser-confirmation") {
    const result = await confirmXssSink(input.url, { sink: "controlled input", authentication: c.credentials[0], parameter: input.key, context: c.cache.get(`xss:context:${input.url}:${input.key}`) as "HTML" | "ATTRIBUTE" | "JAVASCRIPT" | "UNKNOWN" | undefined, canaryId: `bh${randomUUID().replaceAll("-", "")}` });
    return result.confirmed ? [{ title: "Confirmed controlled XSS execution", summary: "An independently generated canary executed in the confined browser after an inert control. No data extraction or stored write performed.", location: input.url, evidenceLevel: "CONFIRMED", controls: ["UNIQUE_EXECUTION_CANARY", "BROWSER_OBSERVED_DIALOG", "INERT_CANARY_CONTROL"], severity: "MEDIUM" }] : [outcome("Browser execution not demonstrated", result.reason?.includes("inert canary") ? "An inert canary also caused a dialog; this is application behavior rather than injected execution." : "No independent execution proof within the confined browser budget.", input.url, result.reason?.includes("inert canary") ? "FALSE_POSITIVE" : "INCONCLUSIVE")];
  }
  const marker = `bh${randomUUID().replaceAll("-", "")}`;
  const r = await c.request(withParam(input.url, input.key, marker), { headers: auth(c) });
  const position = r.body.indexOf(marker);
  if (position >= 0) {
    const before = r.body.slice(0, position);
    const context = before.lastIndexOf("<script") > before.lastIndexOf("</script") ? "JAVASCRIPT" : before.lastIndexOf("<") > before.lastIndexOf(">") ? "ATTRIBUTE" : "HTML";
    c.cache.set(`xss:context:${input.url}:${input.key}`, context);
  }
  return r.body.includes(marker) ? [candidate("Reflected input candidate", "A unique marker was reflected; encoding/context and independent browser execution are still required.", input.url, ["UNIQUE_CANARY"])] : [];
}

async function ssti(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const input = c.corpus.queryInputs.find(p => /template|view|name|message|q|search/i.test(p.key)) ?? firstInput(c); if (!input) return [];
  const marker = `bh${randomUUID().replaceAll("-", "")}`;
  if (t.id === "ssti.literal-control") {
    const payload = payloadVariant("ssti.curly").build(input.value, marker);
    const r = await c.request(withParam(input.url, input.key, payload), { headers: auth(c) });
    return r.body.includes(payload) ? [signal("Literal template reflection", "The expression is returned literally; no template evaluation is confirmed.", input.url)] : [];
  }
  const baseline = await c.request(input.url, { headers: auth(c) });
  if (baseline.error) return [outcome("SSTI baseline unavailable", "Transport failure cannot establish evaluation.", input.url, "INCONCLUSIVE")];
  const inert = `${marker}{not-an-expression-7*7}${marker}`;
  const control = await c.request(withParam(input.url, input.key, inert), { headers: auth(c) });
  if (!comparableResponse(baseline, control)) return [];
  for (const id of sstiVariants(c.corpus.technologies)) {
    const v = payloadVariant(id), p1 = v.build(input.value, marker), p2 = v.build(input.value, marker, true);
    const a = await c.request(withParam(input.url, input.key, p1), { headers: auth(c) });
    if (!comparableResponse(baseline, a) || !a.body.includes(`${marker}49${marker}`) || a.body.includes(p1)) continue;
    const b = await c.request(withParam(input.url, input.key, p2), { headers: auth(c) });
    const repeated = await c.request(withParam(input.url, input.key, p1), { headers: auth(c) });
    if (comparableResponse(a, b) && comparableResponse(a, repeated) && b.body.includes(`${marker}64${marker}`) && repeated.body.includes(`${marker}49${marker}`) && !b.body.includes(p2) && !control.body.includes(`${marker}49${marker}`) && !baseline.body.includes(marker)) return [{ title: "Confirmed arithmetic template evaluation", summary: "Two distinct controlled arithmetic results evaluated repeatedly with baseline and inert controls. The syntax family is evidence, not unique engine identification. No engine escape or command executed.", location: input.url, evidenceLevel: "CONFIRMED", controls: ["ARITHMETIC_49", "INDEPENDENT_ARITHMETIC_64", "INERT_CONTROL", "BASELINE_CONTROL", "REPEATED_EVALUATION", "LITERAL_REFLECTION_REJECTED"], evidence: { variant: id }, severity: "HIGH" }];
    return [outcome("Arithmetic evaluation did not reproduce", "A single rendered value is insufficient without the second expression and repeated controls.", input.url, "INCONCLUSIVE")];
  }
  return [];
}

async function sql(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const inputs = sqlInputs(c); if (!inputs.length) return [];
  if (t.id === "sqli.error-differential") {
    for (const input of inputs) {
      const baseline = await c.request(input.url, { headers: auth(c) });
      const control = await c.request(withParam(input.url, input.key, input.value + "bhcontrol"), { headers: auth(c) });
      if (baseline.error || control.error || dbError.test(baseline.body) || dbError.test(control.body)) continue;
      const payload = payloadVariant("sql.quote").build(input.value, "");
      const a = await c.request(withParam(input.url, input.key, payload), { headers: auth(c) });
      const repeated = await c.request(withParam(input.url, input.key, payload), { headers: auth(c) });
      const dbms = databaseSignature(a.body);
      const valid = !a.error && !repeated.error && a.status === repeated.status && responseType(a) === responseType(repeated) && dbms !== null && dbms === databaseSignature(repeated.body);
      if (!valid) continue;
      c.cache.set(`sql:${input.url}:${input.key}`, dbms);
      c.cache.set("sql:input", input);
      return [{ ...candidate("Repeated database error differential", "The same DBMS error signature repeated independently of baseline and matched inert control. Error handling alone does not prove injection.", input.url, ["REPEATED_DB_SIGNATURE", "BASELINE_NO_SIGNATURE", "INERT_CONTROL_NO_SIGNATURE"]), evidence: { dbms }, evidenceLevel: "VALIDATED" }];
    }
    return [];
  }
  const input = c.cache.get("sql:input") as typeof inputs[number] | undefined ?? inputs[0];
  // Never broaden the original predicate, enumerate columns or add statements.
  if (!/^[a-zA-Z0-9_. -]{1,80}$/.test(input.value)) return [];
  const dbms = c.cache.get(`sql:${input.url}:${input.key}`);
  const id = /^\d+$/.test(input.value) ? dbms && dbms !== "sql-unknown" ? "sql.comment" : "sql.numeric" : "sql.string";
  const v = payloadVariant(id), baseline = await c.request(input.url, { headers: auth(c) });
  const a = await c.request(withParam(input.url, input.key, v.build(input.value, "")), { headers: auth(c) });
  const b = await c.request(withParam(input.url, input.key, v.build(input.value, "", true)), { headers: auth(c) });
  const a2 = await c.request(withParam(input.url, input.key, v.build(input.value, "")), { headers: auth(c) });
  const b2 = await c.request(withParam(input.url, input.key, v.build(input.value, "", true)), { headers: auth(c) });
  const reproducible = sameResponse(baseline, a) && sameResponse(a, a2) && comparableResponse(a, b) && comparableResponse(b, b2) && bodyHash(b.body) === bodyHash(b2.body) && bodyHash(b.body) !== bodyHash(a.body) && !dbError.test(b.body);
  if (!reproducible) return [outcome("SQL predicate difference unconfirmed", "Content controls did not reproduce; status, filter or error-page changes alone are insufficient.", input.url, "INCONCLUSIVE")];
  return [{ title: dbms ? "Confirmed controlled SQL differential" : "Boolean response candidate", summary: dbms ? "Independent repeated database errors and constrained read-only boolean content controls agree; no bulk retrieval or statement execution." : "Repeated boolean content difference may be application behavior; database execution remains unconfirmed.", location: input.url, evidenceLevel: dbms ? "CONFIRMED" : "VALIDATED", controls: ["POSITIVE_MATCHES_BASELINE", "REPEATED_NEGATIVE_CONTROL", "SAME_STATUS_AND_CONTENT_TYPE", ...(dbms ? ["INDEPENDENT_DB_ERROR_TECHNIQUE"] : [])], evidence: { variant: id }, severity: "HIGH" }];
}

async function bola(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const a = c.credentials.find(v => v.purpose === "ACCOUNT_A"), b = c.credentials.find(v => v.purpose === "ACCOUNT_B");
  if (!a || !b?.ownedObjectUrl) return [];
  if (a.identityHash && b.identityHash && a.identityHash === b.identityHash) return [];
  const url = b.ownedObjectUrl, cacheKey = `bola:${url}`;
  if (t.id === "bola.account-differential") {
    const owner = await c.request(url, { headers: credentialHeaders(b) });
    const other = await c.request(url, { headers: credentialHeaders(a) });
    const anonymous = await c.request(url);
    const valid = hasObjectMarker(owner) && sameResponse(owner, other) && deniedObjectControl(owner, anonymous);
    c.cache.set(cacheKey, { valid, owner });
    return valid ? [{ ...candidate("Cross-account object comparison candidate", "The other test identity received the owner-attested object's content. Independent repeated anonymous/account controls are still required.", url, ["EXPLICIT_OWNERSHIP_ATTESTATION", "TWO_TEST_IDENTITIES", "ANONYMOUS_CONTENT_CONTROL"]), evidenceLevel: "VALIDATED" }] : [];
  }
  const prior = c.cache.get(cacheKey) as { valid: boolean; owner: Awaited<ReturnType<TechniqueContext["request"]>> } | undefined;
  if (!prior?.valid) return [];
  const repeated = await c.request(url, { headers: credentialHeaders(a) });
  const anon = await c.request(url);
  return sameResponse(prior.owner, repeated) && deniedObjectControl(prior.owner, anon) ? [{ title: "Confirmed cross-account object access", summary: "A separate test account repeatedly read an owner-attested private object while the anonymous controls did not. Only response hashes and structural metadata are retained.", location: url, evidenceLevel: "CONFIRMED", controls: ["EXPLICIT_OWNERSHIP_ATTESTATION", "REPEATED_TWO_ACCOUNT_CONTENT_MATCH", "INDEPENDENT_ANONYMOUS_CONTROL", "JSON_OBJECT_MARKER"], evidence: safeResponseEvidence(repeated), severity: "HIGH" }] : [];
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
  const controlUrl = new URL(`/bh-not-found-${randomUUID()}`, c.ctx.baseUrl);
  const control = await c.request(controlUrl.toString(), { headers: { "X-Original-URL": controlUrl.pathname } });
  const repeated = await c.request(input, { headers: { "X-Original-URL": new URL(input).pathname } });
  if (sameResponse(variant, control)) return [outcome("Routing-header catch-all rejected", "The apparent bypass reproduces the nonexistent-path response.", input, "FALSE_POSITIVE")];
  return sameResponse(authenticated, variant) && sameResponse(variant, repeated) ? [{ title: "Confirmed read-only routing authorization bypass", summary: "The routing-header response repeatedly matches the authenticated object while the ordinary anonymous request is denied and the catch-all control differs.", location: input, evidenceLevel: "CONFIRMED", controls: ["AUTHENTICATED_OBJECT_CONTROL", "ANONYMOUS_DENIAL", "CATCH_ALL_REJECTED", "REPEATED_CONTENT_MATCH"], severity: "HIGH" }] : [];
}

async function cors(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const url = c.corpus.apiUrls[0] ?? c.ctx.baseUrl;
  if (t.id === "cors.origin-matrix") {
    const observed: HuntObservation[] = [];
    for (const origin of corsOrigins(url)) {
      const r = await c.request(url, { headers: { Origin: origin } });
      if (r.error || r.status !== 200) continue;
      const allowed = r.headers["access-control-allow-origin"], credentials = r.headers["access-control-allow-credentials"] === "true";
      if (allowed !== origin && allowed !== "*") continue;
      // One wildcard configuration is one observation, however many origins accept it.
      if (allowed === "*" && observed.some(o => o.evidence?.allowedOrigin === "*")) continue;
      observed.push({ ...candidate("CORS configuration candidate", allowed === "*" && credentials ? "Wildcard with credentials is rejected by browsers; these headers alone do not grant credentialed access." : "Origin acceptance is a configuration observation; sensitive content, cookie delivery and browser readability are unproven.", url, ["ORIGIN_MATRIX"]), evidence: { allowedOrigin: allowed === "*" ? "*" : origin === "null" ? "null" : "reflected", credentials, variation: corsOrigins(url).indexOf(origin) }, ...(allowed === "*" && credentials ? { evidenceLevel: "FALSE_POSITIVE" as const } : {}) });
    }
    return observed;
  }
  if (!c.credentials[0]) return [];
  const ordinary = await c.request(url, { headers: auth(c) });
  const crossed = await c.request(url, { headers: { ...auth(c), Origin: "https://bh-origin.example.invalid" } });
  const anonymous = await c.request(url);
  const repeated = await c.request(url, { headers: { ...auth(c), Origin: "https://bh-origin.example.invalid" } });
  if (crossed.headers["access-control-allow-origin"] !== "https://bh-origin.example.invalid" || crossed.headers["access-control-allow-credentials"] !== "true" || repeated.headers["access-control-allow-origin"] !== crossed.headers["access-control-allow-origin"] || repeated.headers["access-control-allow-credentials"] !== "true" || !hasObjectMarker(ordinary) || !sameResponse(ordinary, crossed) || !sameResponse(crossed, repeated) || !deniedObjectControl(ordinary, anonymous)) return [];
  return [{ ...candidate("Credentialed CORS content differential", "Authenticated content reproduced under an arbitrary Origin. Cross-site cookie delivery and browser readability still require proof; bearer headers supplied by the scanner do not demonstrate ambient browser authentication.", url, ["AUTHENTICATED_CONTENT_CONTROL", "ANONYMOUS_CONTENT_DIFFERENCE", "REPEATED_ORIGIN_RESPONSE"]), evidenceLevel: "VALIDATED" }];
}

async function jwt(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const isJwt = (v: string) => /^eyJ[^.]+\.eyJ[^.]+\.[^.]*$/.test(v) && v.length <= 8192;
  const credential = c.credentials.find(v => v.bearerToken && isJwt(v.bearerToken) || Object.values(v.cookies ?? {}).some(isJwt));
  if (!credential) return [];
  const bearer = credential.bearerToken && isJwt(credential.bearerToken) ? credential.bearerToken : undefined;
  const cookieName = bearer ? undefined : Object.keys(credential.cookies ?? {}).find(name => isJwt(credential.cookies![name]));
  const token = bearer ?? (cookieName ? credential.cookies?.[cookieName] : undefined); if (!token) return [];
  const parts = token.split(".");
  let header: Record<string, unknown>, payload: Record<string, unknown>;
  try { header = JSON.parse(Buffer.from(parts[0], "base64url").toString()); payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()); if (!header || !payload || typeof header !== "object" || typeof payload !== "object" || Array.isArray(header) || Array.isArray(payload)) return []; } catch { return []; }
  if (t.id === "jwt.claims-audit") return [{ ...signal("JWT validation metadata observed", `Algorithm ${typeof header.alg === "string" && /^[A-Z0-9-]{1,12}$/i.test(header.alg) ? header.alg : "other"}; expiry ${typeof payload.exp === "number" ? payload.exp * 1000 <= Date.now() ? "expired" : "present" : "not present"}. Presence is not validation; no claim values, token or signing material stored.`), evidence: { issuerPresent: typeof payload.iss === "string", audiencePresent: typeof payload.aud === "string" || Array.isArray(payload.aud), notBeforePresent: typeof payload.nbf === "number", kidPresent: "kid" in header, remoteKeyHeaderPresent: "jku" in header || "x5u" in header || "jwk" in header } }];
  const url = credential.ownedObjectUrl ?? c.corpus.apiUrls[0]; if (!url) return [];
  // Isolate the tested credential: a second cookie/bearer must not validate a broken JWT.
  const tokenHeaders = (value: string): Record<string, string> => cookieName ? { Cookie: `${cookieName}=${value}` } : { Authorization: `Bearer ${value}` };
  const valid = await c.request(url, { headers: tokenHeaders(token) });
  const anonymous = await c.request(url);
  if (!hasObjectMarker(valid) || !usefulResponse(valid) || !deniedObjectControl(valid, anonymous)) return [];
  let variants: string[], title: string;
  if (t.id === "jwt.algorithm-differential") {
    variants = ["jwt.none-lower", "jwt.none-title"].map(id => payloadVariant(id).build(token, ""));
    title = "Confirmed JWT unsigned-algorithm acceptance";
  } else if (t.id === "jwt.key-selection-review") {
    // Random missing key IDs only: never paths, SQL, commands, jku or remote JWK URLs.
    const forged = payloadVariant("jwt.missing-kid").build(token, randomUUID());
    const r = await c.request(url, { headers: tokenHeaders(forged) });
    return sameResponse(valid, r) ? [candidate("JWT key-selection integrity candidate", "A modified benign missing key ID retained content access. This may be ignored metadata; independent signature/algorithm validation is required.", url, ["ISOLATED_TOKEN", "BENIGN_MISSING_KEY_ID", "AUTHENTICATED_OBJECT_CONTROL"])] : [];
  } else {
    variants = ["jwt.signature-a", "jwt.signature-c"].map(id => payloadVariant(id).build(token, ""));
    title = "Confirmed JWT signature validation failure";
  }
  const a = await c.request(url, { headers: tokenHeaders(variants[0]) });
  const b = await c.request(url, { headers: tokenHeaders(variants[1]) });
  const repeated = await c.request(url, { headers: tokenHeaders(variants[0]) });
  return sameResponse(valid, a) && sameResponse(a, b) && sameResponse(b, repeated) ? [{ title, summary: "Two independently invalid tokens repeatedly retained the isolated authenticated JSON object while anonymous access differed. Identity claims unchanged; no secret recovery or remote key loading.", location: url, evidenceLevel: "CONFIRMED", controls: ["ISOLATED_TOKEN", "VALID_TOKEN_OBJECT_CONTROL", "ANONYMOUS_CONTROL", "TWO_INVALID_TOKEN_CONTROLS", "INDEPENDENT_REPEAT"], severity: "HIGH" }] : [];
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
  const deadline = Date.now() + Math.min(8000, c.remainingMs());
  let hits = await Promise.all(attempts.map(a => checkOobHit(a.token)));
  while (!hits.every(Boolean) && Date.now() < deadline) {
    try { await wait(Math.min(250, deadline - Date.now()), undefined, { signal: currentTargetExecution().requestGuard?.signal }); }
    catch { return [outcome("OOB correlation interrupted", "Cancellation stopped callback validation; no SSRF proof retained.", input.url, "INCONCLUSIVE")]; }
    hits = await Promise.all(attempts.map(a => checkOobHit(a.token)));
  }
  return hits.every(Boolean) ? [{ ...candidate("Repeated controlled server-side callback", "Two operator-owned callback tokens correlated. This proves a server-side fetch, not permission to access arbitrary LAN/cloud resources or broader SSRF impact.", input.url, ["TWO_UNIQUE_OOB_TOKENS", "OPERATOR_OWNED_DESTINATION", "DATABASE_CALLBACK_CORRELATION"]), evidenceLevel: "VALIDATED" }] : [candidate("Blind SSRF input candidate", "No independent callback proof within the bounded wait; no internal or metadata address was contacted.", input.url)];
}

async function pathError(c: TechniqueContext): Promise<HuntObservation[]> {
  const input = c.corpus.queryInputs.find(p => fileKey.test(p.key)); if (!input) return [];
  const baseline = await c.request(input.url, { headers: auth(c) });
  const marker = randomUUID().replaceAll("-", "");
  const plain = await c.request(withParam(input.url, input.key, `bh_missing_${marker}.txt`), { headers: auth(c) });
  const pattern = /FileNotFound|No such file|failed to open stream|include\(\)|open_basedir/i;
  if (baseline.error || plain.error || pattern.test(baseline.body)) return [];
  if (pattern.test(plain.body)) return [candidate("Path handling differential candidate", "A harmless nonexistent filename caused a path error; traversal or file inclusion is not confirmed.", input.url, ["BASELINE_CONTROL", "NONEXISTENT_BENIGN_FILENAME"])];
  const ids = c.corpus.technologies.some(t => /tomcat|jetty/i.test(t)) ? ["path.java", "path.plain", "path.double"] : c.corpus.technologies.some(t => /iis|asp.net/i.test(t)) ? ["path.unicode", "path.mixed", "path.mangled"] : ["path.plain", "path.double", "path.mangled"];
  for (const id of ids) {
    const value = payloadVariant(id).build("", marker);
    const r = await c.request(withParam(input.url, input.key, value), { headers: auth(c) });
    if (r.error || !pattern.test(r.body)) continue;
    const repeated = await c.request(withParam(input.url, input.key, value), { headers: auth(c) });
    return !repeated.error && r.status === repeated.status && responseType(r) === responseType(repeated) && pattern.test(repeated.body) ? [{ ...candidate("Encoded path parser differential", "A nonexistent marker path produced repeated parser errors absent from baseline and plain filename controls. No real file was requested; this does not prove traversal or inclusion.", input.url, ["BASELINE_CONTROL", "PLAIN_FILENAME_CONTROL", "REPEATED_PATH_ERROR"]), evidence: { variant: id } }] : [outcome("Path error did not repeat", "An isolated error cannot establish path handling behavior.", input.url, "INCONCLUSIVE")];
  }
  return [];
}

async function gitHead(c: TechniqueContext): Promise<HuntObservation[]> {
  const url = new URL("/.git/HEAD", c.ctx.baseUrl).toString();
  const a = await c.request(url), control = await c.request(new URL(`/bh-not-found-${randomUUID()}`, c.ctx.baseUrl).toString()), repeated = await c.request(url);
  return a.status === 200 && /^ref: refs\/heads\/[A-Za-z0-9._/-]+\s*$/.test(a.body) && a.body === repeated.body && a.body !== control.body ? [{ title: "Confirmed Git HEAD exposure", summary: "The minimal non-secret Git HEAD marker repeated and differed from the catch-all. No repository/configuration/credential dump was retrieved.", location: url, evidenceLevel: "CONFIRMED", controls: ["GIT_HEAD_STRUCTURAL_MARKER", "INDEPENDENT_REPEAT", "CATCH_ALL_CONTROL"], severity: "LOW" }] : [];
}
export async function executeHuntTechnique(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  if (t.probeRisk === "FORBIDDEN_AUTOMATIC" || ((t.requiresApproval || t.probeRisk === "REQUIRES_APPROVAL" || ["STATE_CHANGING", "HIGH_RISK"].includes(t.risk)) && !isHuntTechniqueApproved(t.id, c.approvedTechniques)) || t.implementation !== "IMPLEMENTED") throw new Error("UNSUPPORTED_TECHNIQUE");
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
