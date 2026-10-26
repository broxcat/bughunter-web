import { setTimeout as delay } from "node:timers/promises";
import { assertExecutionUrl, loadTargetExecution, withTargetExecution, type TargetExecution, type TargetRequestGuard } from "@/server/execution";
import { isSafeReadUrl } from "@/lib/hunt/safety";

export const CONNECTION_LIMITS = { requests: 30, timeoutMs: 35000, intervalMs: 100, concurrency: 1 };
/** Login is an explicit action; Hunt's GET-only guard remains unchanged. */
export class ConnectionGuard implements TargetRequestGuard {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly started = Date.now();
  private readonly timer = setTimeout(() => this.controller.abort(), CONNECTION_LIMITS.timeoutMs);
  private nextAt = 0;
  private tail = Promise.resolve();
  requests = 0;
  private readonly loginActions = new Map<string, string>();
  private readonly cancel = () => this.controller.abort();
  constructor(private readonly execution: TargetExecution, private readonly externalSignal?: AbortSignal) {
    if (externalSignal?.aborted) this.controller.abort();
    externalSignal?.addEventListener("abort", this.cancel, { once: true });
  }
  remainingMs = () => Math.max(0, CONNECTION_LIMITS.timeoutMs - (Date.now() - this.started));
  allowLoginAction = (url: string, detectedPasswordForm = false, passwordField = "password") => {
    assertExecutionUrl(url, this.execution);
    const u = new URL(url);
    if (!isSafeReadUrl(url) || (!detectedPasswordForm && !/(?:^|\/)(?:login|log-in|signin|sign-in|session|sessions|auth)(?:\/|\.|$)/i.test(u.pathname)) || /logout|signout|delete|register|reset|purchase|transfer/i.test(u.pathname)) throw new Error("Unsupported login action");
    if (!passwordField || passwordField.length > 128 || /[\r\n"']/.test(passwordField)) throw new Error("Unsupported login field");
    this.loginActions.set(u.toString(), passwordField);
  };
  assertRequest = (url: string, method: string, body?: string) => {
    if (method !== "POST") return;
    const field = this.loginActions.get(new URL(url).toString());
    if (!field || !body || body.length > 32768 || !isSafeReadUrl(url)) throw new Error("Unsupported authentication request");
    let hasPassword = Boolean(new URLSearchParams(body).get(field));
    try { const object = JSON.parse(body); hasPassword ||= typeof object?.[field] === "string" && object[field].length > 0; } catch { /* native form */ }
    hasPassword ||= body.includes(`name="${field}"`); // native multipart password form
    if (!hasPassword) throw new Error("Only detected credential submissions are allowed");
  };
  acquire = async (url: string, method: string) => {
    assertExecutionUrl(url, this.execution);
    if (this.signal.aborted || !this.remainingMs()) throw new Error("Connection check cancelled");
    const u = new URL(url);
    if (!(method === "GET" || method === "HEAD" ? isSafeReadUrl(url) : method === "POST" && isSafeReadUrl(url) && this.loginActions.has(u.toString()))) throw new Error("Unsupported authentication request");
    if (this.requests >= CONNECTION_LIMITS.requests) throw new Error("Connection request limit");
    this.requests++;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new Error("Connection check cancelled"));
        this.signal.addEventListener("abort", abort, { once: true });
        void previous.then(() => { this.signal.removeEventListener("abort", abort); resolve(); });
      });
      let current: TargetExecution;
      try { current = await loadTargetExecution(this.execution.targetId); }
      catch { this.controller.abort(); throw new Error("Scope changed"); }
      if (current.host !== this.execution.host || current.requiredUserAgent !== this.execution.requiredUserAgent) { this.controller.abort(); throw new Error("Scope changed"); }
      const wait = Math.max(0, this.nextAt - Date.now()); this.nextAt = Date.now() + wait + CONNECTION_LIMITS.intervalMs;
      if (wait) await delay(wait, undefined, { signal: this.signal });
      if (this.signal.aborted || !this.remainingMs()) throw new Error("Connection check cancelled");
      return release;
    } catch (e) { release(); throw e; }
  };
  close() { clearTimeout(this.timer); this.externalSignal?.removeEventListener("abort", this.cancel); this.controller.abort(); }
}
const active = new Set<string>();
const attempts = new Map<string, number[]>();
export async function withConnectionExecution<T>(targetId: string, work: (guard: ConnectionGuard) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const recent = (attempts.get(targetId) ?? []).filter(t => Date.now() - t < 60000);
  if (active.has(targetId) || recent.length >= 5) throw new Error("CONNECTION_RATE_LIMIT");
  const execution = await loadTargetExecution(targetId);
  if (active.has(targetId)) throw new Error("CONNECTION_RATE_LIMIT");
  active.add(targetId); attempts.set(targetId, [...recent, Date.now()]);
  const guard = new ConnectionGuard(execution, signal);
  try { return await withTargetExecution({ ...execution, requestGuard: guard }, () => work(guard)); }
  finally { guard.close(); active.delete(targetId); }
}
