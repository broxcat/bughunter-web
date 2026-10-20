// Shared, authenticated, depth-limited crawl used by ALL hunt families so they
// discover candidate URLs/params from the real app — including pages that need a
// session — instead of each re-parsing only the public root page.
//
// Before this, every family independently fetched ctx.baseUrl (root only,
// anonymous), so IDOR/SSRF/CSRF/SQLi/CmdI/SSTI never saw authenticated routes
// like /dashboard, /courses, /profile. Here we crawl once per scan run (cached),
// authenticated with the target's first TargetCredential when one exists (reusing
// loadTargetCredentials, which auto-logs-in for EMAIL_PASSWORD mode), to a small
// depth, and expose:
//   - html: the concatenated page bodies PLUS a synthetic <a href> appendix of
//     every discovered absolute URL, so each family's existing HTML extractors
//     (links, GET-form fields) work on the richer corpus with resolved URLs.
//   - urls: the deduped same-origin URL inventory.
// Never throws; degrades to an anonymous root fetch (or empty) on any failure.

import { probe } from "./http";
import { loadTargetCredentials, credentialHeaders } from "@/server/credentials";
import type { ScanContext } from "./context";

const MAX_PAGES = 25;
const MAX_DEPTH = 2; // root = depth 0; reaches dashboard sub-pages without exploding
const PAGE_TIMEOUT_MS = 10_000;

export interface DiscoveryCorpus {
  /** Concatenated crawled page bodies + a synthetic anchor appendix of all URLs. */
  html: string;
  /** Deduped same-origin absolute URLs discovered. */
  urls: string[];
  /** Whether the crawl ran authenticated (a credential was available). */
  authenticated: boolean;
}

// One crawl per scan run, shared across the ~6 families that run sequentially in
// the worker. Keyed by scanRunId; stores the in-flight promise so concurrent
// callers coalesce onto a single crawl.
const cache = new Map<string, Promise<DiscoveryCorpus>>();

function sameOriginLinks(html: string, baseUrl: string, host: string): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    try {
      const abs = new URL(raw, baseUrl);
      if (abs.host === host && /^https?:$/.test(abs.protocol)) {
        abs.hash = "";
        out.add(abs.toString());
      }
    } catch {
      /* ignore */
    }
  };
  for (const m of html.matchAll(/(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) add(m[0]);
  return [...out];
}

async function crawl(ctx: ScanContext): Promise<DiscoveryCorpus> {
  let host: string;
  try {
    host = new URL(ctx.baseUrl).host;
  } catch {
    return { html: "", urls: [], authenticated: false };
  }

  // Authenticate with the first available credential (if any). loadTargetCredentials
  // decrypts in-process and, for EMAIL_PASSWORD, auto-logs-in to mint cookies.
  let headers: Record<string, string> = {};
  let authenticated = false;
  try {
    const creds = await loadTargetCredentials(ctx.targetId);
    if (creds.length > 0) {
      headers = credentialHeaders(creds[0]);
      authenticated = Object.keys(headers).length > 0;
    }
  } catch {
    /* anonymous crawl on failure */
  }

  const bodies: string[] = [];
  const discovered = new Set<string>();
  const visited = new Set<string>();
  let queue: Array<{ url: string; depth: number }> = [{ url: ctx.baseUrl, depth: 0 }];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const { url, depth } = queue.shift()!;
    const norm = url.replace(/#.*$/, "");
    if (visited.has(norm)) continue;
    visited.add(norm);

    const res = await probe(norm, { headers, timeoutMs: PAGE_TIMEOUT_MS });
    if (res.error || !res.body) continue;
    bodies.push(res.body);
    discovered.add(norm);

    if (depth < MAX_DEPTH) {
      for (const link of sameOriginLinks(res.body, ctx.baseUrl, host)) {
        discovered.add(link);
        if (!visited.has(link) && visited.size + queue.length < MAX_PAGES) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    }
  }

  const urls = [...discovered];
  // Append every discovered URL as an absolute anchor so the families' HTML
  // extractors pick them up with URLs already resolved (no relative-path drift
  // from concatenating sub-page bodies).
  const appendix = urls.map((u) => `<a href="${u}"></a>`).join("\n");
  return { html: bodies.join("\n") + "\n" + appendix, urls, authenticated };
}

/**
 * Authenticated, depth-limited crawl of the target, cached per scan run. Returns
 * a corpus the families parse for candidate URLs/params. Never throws.
 */
export function discoverCorpus(ctx: ScanContext): Promise<DiscoveryCorpus> {
  const cached = cache.get(ctx.scanRunId);
  if (cached) return cached;
  const p = crawl(ctx).catch(() => ({ html: "", urls: [], authenticated: false }));
  cache.set(ctx.scanRunId, p);
  return p;
}
