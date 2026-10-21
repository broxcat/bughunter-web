// Minimal HTTP probe helper for the vuln-class scanners. Uses global fetch with
// a hard per-request timeout and manual redirect handling (so a 30x is observed,
// not silently followed — important for auth/bypass checks). Never throws: a
// network error comes back as status 0 with `error` set.
//
// This intentionally hits the scan target directly — that is the whole point of
// an authorized scan (the worker has already confirmed the Scope is APPROVED).

export interface ProbeOptions {
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
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: opts.headers,
      body: opts.body,
      redirect: "manual",
      signal: controller.signal,
    });
    const raw = await res.text().catch(() => "");
    const body = raw.length > maxBody ? raw.slice(0, maxBody) : raw;
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
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
    clearTimeout(timer);
  }
}
