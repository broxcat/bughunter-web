import { throwIfScanAborted } from "@/server/scanControl";
import { isSafeReadUrl } from "@/lib/observationSafety";
import { assertExecutionUrl } from '@/server/execution';
// Anonymous, depth-limited Recon observation collection. Discovered URLs
// remain confined to the selected host and never expand authorization.
// Bodies are transient only; the persisted corpus contains sanitized metadata.

import { probe } from "./http";
import type { ScanContext } from "./context";

const MAX_PAGES = 25;
const MAX_DEPTH = 2; // root = depth 0; reaches dashboard sub-pages without exploding
const PAGE_TIMEOUT_MS = 10_000;

export interface DiscoveryExecution {
  successfulRequests: number;
  failedRequests: number;
  // Fixed codes only; never retain transport messages or credential values.
  issues: string[];
}
const interruptionCodes = new Set(["SCOPE_REVOKED", "HUNT_TIMEOUT", "TOTAL_REQUEST_LIMIT", "DISCOVERY_REQUEST_LIMIT", "CONCURRENCY_LIMIT"]);

export interface DiscoveryCorpus {
  execution?: DiscoveryExecution;
  /** Concatenated crawled page bodies + a synthetic anchor appendix of all URLs. */
  html: string;
  pages?: { url: string; body: string; headers: Record<string, string>; status: number }[];
  /** Deduped same-origin absolute URLs discovered. */
  urls: string[];
  /** Whether the crawl ran authenticated (a credential was available). */
  authenticated: boolean;
}

// One cached crawl per Recon run. Keyed by scanRunId; stores the in-flight promise so concurrent
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

async function crawl(ctx: ScanContext, seeds: string[] = []): Promise<DiscoveryCorpus> {
  const execution: DiscoveryExecution = { successfulRequests: 0, failedRequests: 0, issues: [] };
  let host: string;
  try {
    host = new URL(ctx.baseUrl).host;
  } catch {
    return { html: "", urls: [], authenticated: false };
  }

  // Authentication is never inferred from available credentials. Explicit,
  // per-context mapping runs separately and does not share this cache.
  const authenticated = false;

  const bodies: string[] = [];
  const pages: NonNullable<DiscoveryCorpus["pages"]> = [];
  const discovered = new Set<string>();
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [...new Set([ctx.baseUrl, ...seeds])].slice(0, MAX_PAGES).filter(isSafeReadUrl).map(url => ({ url, depth: 0 }));

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    throwIfScanAborted();
    const { url, depth } = queue.shift()!;
    const norm = new URL(url.replace(/#.*$/, "")).toString();
    if (visited.has(norm) || !isSafeReadUrl(norm)) continue;
    try { assertExecutionUrl(norm); } catch { continue; }
    visited.add(norm);

    const res = await probe(norm, { timeoutMs: PAGE_TIMEOUT_MS });
    if (res.error) {
      execution.failedRequests++;
      const code = interruptionCodes.has(res.error) ? res.error : "DISCOVERY_TRANSPORT_ERROR";
      if (!execution.issues.includes(code)) execution.issues.push(code);
      if (interruptionCodes.has(code)) break;
      continue;
    }
    execution.successfulRequests++;
    bodies.push(res.body);
    pages.push({ url: norm, body: res.body, headers: res.headers, status: res.status });
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
  return { html: bodies.join("\n") + "\n" + appendix, urls, authenticated, pages, execution };
}

/**
 * Anonymous, depth-limited crawl of the target, cached per scan run. Returns
 * a corpus the families parse for candidate URLs/params. Never throws.
 */
export function discoverCorpus(ctx: ScanContext, seeds: string[] = []): Promise<DiscoveryCorpus> {
  const key = `${ctx.scanRunId}:ANONYMOUS:${ctx.baseUrl}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const p = crawl(ctx, seeds).catch(() => {
    throwIfScanAborted();
    return { html: "", urls: [], authenticated: false, execution: { successfulRequests: 0, failedRequests: 1, issues: ["DISCOVERY_FAILED"] } };
  });
  cache.set(key, p);
  return p;
}

export function clearDiscoveryCorpus(scanRunId: string) { for (const key of cache.keys()) if (key.startsWith(`${scanRunId}:`)) cache.delete(key); }
