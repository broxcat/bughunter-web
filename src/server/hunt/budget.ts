import { currentTargetExecution, withTargetExecution, type TargetRequestGuard } from "@/server/execution";
import { isSafeReadUrl } from "@/lib/hunt/safety";
export const HUNT_LIMITS = { maxTechniquesPerFamily: 4, maxRequestsPerTechnique: 8, maxRequestsPerFamily: 24, maxPayloadsPerParameter: 8, maxConfirmationsPerFamily: 1, minRequestIntervalMs: 100, maxTotalRequests: 100, maxDiscoveryRequests: 12, requestTimeoutMs: 5000, familyTimeoutMs: 20000, globalTimeoutMs: 120000, concurrency: 1, maxBodyBytes: 65536, maxCandidates: 80 } as const;
export class HuntLimitError extends Error { constructor(public code: string) { super(code); } }
export class HuntBudget {
  constructor(private readonly assertScope?: () => Promise<void>) {}
  requests = 0;
  activeRequests = 0;
  discoveryRequests = 0;
  startedAt = Date.now();
  family: { name: string; requests: number; deadline: number } | null = null;
  technique: { id: string; requests: number; maxRequests: number } | null = null;
  readonly controller = new AbortController();
  private nextRequestAt = 0;
  private readonly parameterValues = new Map<string, Set<string>>();
  private readonly timer = setTimeout(() => this.controller.abort(), HUNT_LIMITS.globalTimeoutMs);
  beginFamily(name: string) { this.parameterValues.clear(); this.family = { name, requests: 0, deadline: Date.now() + HUNT_LIMITS.familyTimeoutMs }; }
  beginTechnique(id: string, maxRequests: number) { this.technique = { id, requests: 0, maxRequests: Math.min(maxRequests, HUNT_LIMITS.maxRequestsPerTechnique) }; }
  remainingMs = () => Math.max(0, Math.min(this.startedAt + HUNT_LIMITS.globalTimeoutMs, this.family?.deadline ?? Infinity) - Date.now());
  acquire = (url: string, method: string) => {
    if (!isSafeReadUrl(url) || !["GET", "HEAD"].includes(method.toUpperCase())) throw new HuntLimitError("STATE_CHANGING_REQUEST_UNSUPPORTED");
    if (!this.remainingMs() || this.controller.signal.aborted) throw new HuntLimitError("HUNT_TIMEOUT");
    if (this.requests >= HUNT_LIMITS.maxTotalRequests) throw new HuntLimitError("TOTAL_REQUEST_LIMIT");
    if (this.family && this.family.requests >= HUNT_LIMITS.maxRequestsPerFamily) throw new HuntLimitError("FAMILY_REQUEST_LIMIT");
    if (this.technique && this.technique.requests >= this.technique.maxRequests) throw new HuntLimitError("TECHNIQUE_REQUEST_LIMIT");
    if (!this.technique && this.discoveryRequests >= HUNT_LIMITS.maxDiscoveryRequests) throw new HuntLimitError("DISCOVERY_REQUEST_LIMIT");
    if (this.activeRequests >= HUNT_LIMITS.concurrency) throw new HuntLimitError("CONCURRENCY_LIMIT");
    const u = new URL(url);
    for (const [key, value] of u.searchParams) {
      const id = `${u.origin}${u.pathname}:${key}`, values = this.parameterValues.get(id) ?? new Set<string>();
      if (!values.has(value) && values.size >= HUNT_LIMITS.maxPayloadsPerParameter) throw new HuntLimitError("PARAMETER_PROBE_LIMIT");
      values.add(value); this.parameterValues.set(id, values);
    }
    this.requests++; this.activeRequests++;
    if (this.family) this.family.requests++;
    if (this.technique) this.technique.requests++; else this.discoveryRequests++;
    let released = false;
    return () => { if (!released) { this.activeRequests--; released = true; } };
  };
  guard(): TargetRequestGuard { return { acquire: async (url, method) => {
    if (this.controller.signal.aborted) throw new HuntLimitError("HUNT_TIMEOUT");
    try { await this.assertScope?.(); } catch { this.controller.abort("SCOPE_REVOKED"); throw new HuntLimitError("SCOPE_REVOKED"); }
    const release = this.acquire(url, method);
    const waitMs = Math.max(0, this.nextRequestAt - Date.now());
    this.nextRequestAt = Date.now() + waitMs + HUNT_LIMITS.minRequestIntervalMs;
    try {
      if (waitMs) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new HuntLimitError("HUNT_TIMEOUT")); };
        const timer = setTimeout(() => { this.controller.signal.removeEventListener("abort", abort); resolve(); }, Math.min(waitMs, this.remainingMs()));
        this.controller.signal.addEventListener("abort", abort, { once: true });
      });
      if (!this.remainingMs() || this.controller.signal.aborted) throw new HuntLimitError("HUNT_TIMEOUT");
      return release;
    } catch (e) { release(); throw e; }
  }, remainingMs: this.remainingMs, signal: this.controller.signal }; }
  run<T>(work: () => T): T { return withTargetExecution({ ...currentTargetExecution(), requestGuard: this.guard() }, work); }
  close() { clearTimeout(this.timer); this.controller.abort(); }
}
