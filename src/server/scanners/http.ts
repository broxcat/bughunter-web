import { beforeScanNetwork, currentScanControl, recordUsefulScanWork, throwIfScanAborted } from "@/server/scanControl";
import { assertExecutionUrl, executionHeaders, currentTargetExecution } from "@/server/execution";
// Minimal HTTP probe helper for the vuln-class scanners. Uses global fetch with
// a hard per-request timeout and manual redirect handling (so a 30x is observed,
// not silently followed — important for auth/bypass checks). Never throws: a
// network error comes back as status 0 with `error` set.
//
// This intentionally hits the scan target directly — that is the whole point of
// an authorized scan (the worker has already confirmed the Scope is APPROVED).

export interface ProbeOptions {
  signal?: AbortSignal;
  method?: string;
  headers?: Record<string, string>;
  /** Optional request body (e.g. an XML/SOAP document for an XXE probe). */
  body?: string;
  timeoutMs?: number;
  /** Cap how much of the body we read into memory. */
  maxBodyBytes?: number;
}

export interface ProbeResult {
  url: string;
  method: string;
  status: number;
  ms: number;
  bodyLen: number;
  /** Body text, truncated to maxBodyBytes. */
  body: string;
  headers: Record<string, string>;
  error?: string;
}

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MAX_BODY = 64 * 1024;

export async function probe(
  url: string,
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  const method = opts.method ?? "GET";
  const maxBody = Math.min(opts.maxBodyBytes ?? DEFAULT_MAX_BODY, DEFAULT_MAX_BODY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
  const started = Date.now();
  let release: (() => void) | undefined;
  let resourceDone!: () => void;
  const done = new Promise<void>(resolve => { resourceDone = resolve; });
  const scan = currentScanControl();
  const releaseResource = scan?.track(async () => { controller.abort(); await done; });
  try {
    throwIfScanAborted();
    opts.signal?.throwIfAborted();
    assertExecutionUrl(url);
    const guard = currentTargetExecution().requestGuard;
    guard?.assertRequest?.(url, method, opts.body);
    release = await guard?.acquire(url, method);
    await beforeScanNetwork();
    throwIfScanAborted();
    opts.signal?.throwIfAborted();
    const res = await fetch(url, {
      method,
      headers: executionHeaders(opts.headers),
      body: opts.body,
      redirect: "manual",
      signal: AbortSignal.any([controller.signal, ...(scan ? [scan.signal] : []), ...(opts.signal ? [opts.signal] : []), ...(guard ? [guard.signal, AbortSignal.timeout(Math.max(1, Math.min(5000, guard.remainingMs())))] : [])]),
    });
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    if (reader) {
      try {
        while (bytes < maxBody) {
          const { done, value } = await reader.read(); if (done) break;
          const part = value.subarray(0, maxBody - bytes); chunks.push(part); bytes += part.length;
        }
      } finally { await reader.cancel().catch(() => {}); }
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw.length > maxBody ? raw.slice(0, maxBody) : raw;
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    await recordUsefulScanWork();
    return {
      url,
      method,
      status: res.status,
      ms: Date.now() - started,
      bodyLen: raw.length,
      body,
      headers,
    };
  } catch (err) {
    throwIfScanAborted();
    opts.signal?.throwIfAborted();
    return {
      url,
      method,
      status: 0,
      ms: Date.now() - started,
      bodyLen: 0,
      body: "",
      headers: {},
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    release?.();
    clearTimeout(timer);
    resourceDone(); releaseResource?.();
  }
}
