import { objectReference } from "./fingerprints";
import { isLikelyUserParam } from "@/server/scanners/paramFilter";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSafeReadUrl, safeObservationUrl } from "@/lib/hunt/safety";
import type { HuntSurface } from "@/lib/hunt/catalog";
import { discoverCorpus, type DiscoveryCorpus } from "@/server/scanners/discovery";
import type { ScanContext } from "@/server/scanners/context";

const urlKey = /^(url|uri|src|source|dest|destination|avatar|image|import|callback|webhook|feed|fetch|proxy|remote|redirect)$/i;
const fileKey = /^(file|filename|path|filepath|template|include|document|download|resource)$/i;
const secretKey = /token|secret|password|session|cookie|authorization|api.?key|code$/i;
export interface FormObservation { url: string; method: string; fields: string[]; tokenPresent: boolean; contentType: string }
export interface CookieObservation { name: string; sameSite: string | null; secure: boolean; httpOnly: boolean }
export interface HuntCorpus {
  publicXssSurface: boolean;
  raw: DiscoveryCorpus; urls: string[]; technologies: string[]; authUrls: string[]; queryInputs: { url: string; key: string; value: string }[];
  forms: FormObservation[]; jsUrls: string[]; cookies: CookieObservation[]; xmlUrls: string[];
  oauthUrls: string[]; objectUrls: string[]; jwtPresent: boolean; apiUrls: string[];
  surface: HuntSurface;
}
export function analyzeCorpus(raw: DiscoveryCorpus, baseUrl: string): HuntCorpus {
  const base = new URL(baseUrl);
  const observedUrls = [...new Set([baseUrl, ...raw.urls])].filter(u => { try { const v = new URL(u); return /^https?:$/.test(v.protocol) && v.host === base.host && !v.username && !v.password; } catch { return false; } });
  const urls = observedUrls.filter(u => { try { return new URL(u).host === base.host && isSafeReadUrl(u) && ![...new URL(u).searchParams.keys()].some(k => secretKey.test(k)); } catch { return false; } }).slice(0, 100);
  const queryInputs = urls.flatMap(url => [...new URL(url).searchParams].filter(([k, v]) => isLikelyUserParam(url, k) && !secretKey.test(k) && v.length <= 256 && !/eyJ[A-Za-z0-9_-]+\./.test(v)).map(([key, value]) => ({ url, key, value }))).slice(0, 40);
  const forms: FormObservation[] = [];
  for (const match of raw.html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    try {
      const action = /action\s*=\s*["']([^"']*)/i.exec(match[1])?.[1] ?? baseUrl;
      const u = new URL(action, baseUrl); if (u.host !== base.host) continue;
      const fields = [...match[2].matchAll(/(?:name|id)\s*=\s*["']([^"']+)/gi)].map(m => m[1]).slice(0, 30);
      forms.push({ url: u.origin + u.pathname, method: (/method\s*=\s*["']?([a-z]+)/i.exec(match[1])?.[1] ?? "GET").toUpperCase(), fields, tokenPresent: fields.some(f => /csrf|xsrf|requestverificationtoken/i.test(f)), contentType: /enctype\s*=\s*["']([^"']+)/i.exec(match[1])?.[1] ?? "application/x-www-form-urlencoded" });
    } catch { /* malformed observation */ }
  }
  // JS API calls are observations only: never execute their method or body.
  for (const m of raw.html.matchAll(/fetch\(\s*["']([^"']+)["']\s*,\s*\{[^}]{0,1000}?method\s*:\s*["'](POST|PUT|PATCH|DELETE)["']/gi)) {
    try { const u = new URL(m[1], baseUrl); if (u.host === base.host) forms.push({ url: u.origin + u.pathname, method: m[2].toUpperCase(), fields: [], tokenPresent: /csrf|xsrf/i.test(m[0]), contentType: /application\/json/i.test(m[0]) ? "application/json" : "unknown" }); } catch { /* malformed */ }
  }
  for (const f of forms) if (!["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain"].includes(f.contentType)) f.contentType = "unknown";
  const cookies: CookieObservation[] = [];
  for (const page of raw.pages ?? []) for (const segment of (page.headers["set-cookie"] ?? "").split(/,(?=\s*[\w.-]+=)/)) {
    const name = /^\s*([^=;\s]+)=/.exec(segment)?.[1]; if (!name) continue;
    cookies.push({ name, sameSite: /;\s*SameSite=(\w+)/i.exec(segment)?.[1]?.toLowerCase() ?? null, secure: /;\s*Secure(?:;|$)/i.test(segment), httpOnly: /;\s*HttpOnly(?:;|$)/i.test(segment) });
  }
  const jsUrls = urls.filter(u => /\.m?js(?:\?|$)/i.test(u));
  const xmlUrls = (raw.pages ?? []).filter(p => /(?:application|text)\/(?:[\w.+-]*\+)?xml|soap/i.test(p.headers["content-type"] ?? "") || /^\s*<\?xml\b/.test(p.body)).map(p => p.url);
  const oauthUrls = observedUrls.filter(u => { const url = new URL(u); return /oauth|authorize|openid/i.test(url.pathname) && ["client_id", "response_type", "redirect_uri"].some(k => url.searchParams.has(k)); });
  const objectUrls = urls.filter(objectReference);
  const apiUrls = urls.filter(u => /\/(api|v\d+|graphql|account|profile|user|documents?)\b/i.test(new URL(u).pathname));
  const jwtPresent = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/.test(raw.html);
  const hints = (raw.pages ?? []).map(p => [p.headers.server, p.headers["x-powered-by"]].join(" ")).join(" ");
  const technologies = [...new Set((hints.match(/\b(?:next\.js|express|node|rails|ruby|django|jinja|twig|php|nginx|apache|iis|asp\.net|tomcat|jetty|spring|java)\b/gi) ?? []).map(v => v.toLowerCase()))];
  const authUrls = urls.filter(u => /\/(?:auth|login|signin|oauth|openid)(?:\/|$)/i.test(new URL(u).pathname));
  const surface: HuntSurface = { queryInputs: queryInputs.length > 0, objectReferences: objectUrls.length > 0, forms: forms.length > 0, javascript: jsUrls.length > 0 || /<script|innerHTML|postMessage|document\.write/i.test(raw.html), cookies: cookies.length > 0, jwt: jwtPresent, oauth: oauthUrls.length > 0, xml: xmlUrls.length > 0, urlInputs: queryInputs.some(p => urlKey.test(p.key)) || forms.some(f => f.fields.some(k => urlKey.test(k))), fileInputs: queryInputs.some(p => fileKey.test(p.key)) || forms.some(f => f.fields.some(k => fileKey.test(k))), businessFlows: forms.some(f => f.method !== "GET" || f.fields.some(k => /price|quantity|plan|role|amount|total/i.test(k))) || /checkout|coupon|workflow|step[\/-]?\d|redeem/i.test(raw.html), apiEndpoints: apiUrls.length > 0 };
  const parameterPages = (raw.pages ?? []).filter(p => { try { const u = new URL(p.url); return u.host === new URL(baseUrl).host && u.searchParams.size > 0; } catch { return false; } });
  const publicXssSurface = !raw.authenticated && parameterPages.length > 0 && parameterPages.every(p => p.status >= 200 && p.status < 300);
  return { publicXssSurface, raw, urls, technologies, authUrls, queryInputs, forms: forms.slice(0, 40), jsUrls, cookies, xmlUrls, oauthUrls, objectUrls, jwtPresent, apiUrls, surface };
}
const formSchema = z.object({ url: z.string(), method: z.string(), fields: z.array(z.string()).max(30), tokenPresent: z.boolean(), contentType: z.string() });
const cookieSchema = z.object({ name: z.string(), sameSite: z.string().nullable(), secure: z.boolean(), httpOnly: z.boolean() });
export const persistedCorpusSchema = z.object({ authenticated: z.boolean().optional(), publicXssSurface: z.boolean().default(false), technologies: z.array(z.string()).max(20).default([]), authUrls: z.array(z.string()).max(20).default([]), jsUrls: z.array(z.string()).max(50).default([]), forms: z.array(formSchema).max(40).default([]), cookies: z.array(cookieSchema).max(40).default([]), queryParams: z.array(z.object({ url: z.string(), key: z.string() })).max(40).default([]), version: z.literal(1), capturedAt: z.iso.datetime(), urls: z.array(z.string()).max(100), surface: z.object({ queryInputs: z.boolean(), objectReferences: z.boolean(), forms: z.boolean(), javascript: z.boolean(), cookies: z.boolean(), jwt: z.boolean(), oauth: z.boolean(), xml: z.boolean(), urlInputs: z.boolean(), fileInputs: z.boolean(), businessFlows: z.boolean(), apiEndpoints: z.boolean() }) });
export function persistableCorpus(corpus: HuntCorpus) {
  return { authenticated: corpus.raw.authenticated, publicXssSurface: corpus.publicXssSurface, technologies: corpus.technologies, authUrls: corpus.authUrls.slice(0, 20).map(safeObservationUrl), jsUrls: corpus.jsUrls.slice(0, 50).map(safeObservationUrl), forms: corpus.forms.map(f => ({ ...f, url: safeObservationUrl(f.url), fields: f.fields.filter(v => /^[a-z_][a-z0-9_.[\]-]{0,63}$/i.test(v)) })), cookies: corpus.cookies.slice(0, 40).map(c => ({ ...c })), queryParams: corpus.queryInputs.slice(0, 40).map(p => ({ url: safeObservationUrl(p.url), key: p.key })), version: 1 as const, capturedAt: new Date().toISOString(), urls: corpus.urls.map(u => { const url = new URL(safeObservationUrl(u)); url.search = ""; return url.toString(); }).filter(u => !u.includes("REDACTED")), surface: { ...corpus.surface } };
}
export async function recentReconCorpus(targetId: string) {
  const run = await prisma.scanRun.findFirst({ where: { targetId, type: "RECON", status: "COMPLETED" }, orderBy: { createdAt: "desc" }, select: { reconCorpus: true } });
  const parsed = persistedCorpusSchema.safeParse(run?.reconCorpus);
  return parsed.success && Date.now() - Date.parse(parsed.data.capturedAt) < 60 * 60 * 1000 ? parsed.data : null;
}
export async function collectHuntCorpus(ctx: ScanContext) {
  const recon = await recentReconCorpus(ctx.targetId);
  const corpus = analyzeCorpus(await discoverCorpus(ctx, recon?.urls ?? []), ctx.baseUrl);
  if (recon) {
    const sameHost = (u: string) => { try { return new URL(u).host === ctx.host && !u.includes("REDACTED"); } catch { return false; } };
    corpus.forms = [...corpus.forms, ...recon.forms.filter(f => sameHost(f.url))].filter((f, i, all) => all.findIndex(v => v.url === f.url && v.method === f.method) === i).slice(0, 40);
    corpus.cookies = [...corpus.cookies, ...recon.cookies].filter((c, i, all) => all.findIndex(v => v.name === c.name) === i).slice(0, 40);
    corpus.technologies = [...new Set([...corpus.technologies, ...recon.technologies])].slice(0, 20);
    corpus.surface.forms ||= corpus.forms.length > 0;
    corpus.surface.cookies ||= corpus.cookies.length > 0;
    corpus.surface.businessFlows ||= corpus.forms.some(f => f.method !== "GET");
  }
  return corpus;
}
