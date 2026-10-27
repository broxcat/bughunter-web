import { prisma } from "@/lib/prisma";
import { loadTargetExecution } from "@/server/execution";
import { publishScanLog } from "@/server/queue/logBus";

export interface ScanContext {
  scanRunId: string;
  targetId: string;
  userId: string;
  /** The raw host as stored on the Target. */
  host: string;
  /** Normalized base URL (scheme guaranteed, no trailing slash). */
  baseUrl: string;
}

/**
 * Build a base URL from a bare host and its optional stored scheme. Falls back
 * to https when no scheme was recorded. Defensive against a host that still
 * carries a scheme (older rows / odd input).
 */
export function toBaseUrl(host: string, scheme?: string | null): string {
  const h = host.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(h)) return h;
  const s = scheme && /^https?$/i.test(scheme) ? scheme.toLowerCase() : "https";
  return `${s}://${h}`;
}

/** Load the full scan context from a scanRunId, or null if the run is gone. */
export async function loadScanContext(
  scanRunId: string,
): Promise<ScanContext | null> {
  const run = await prisma.scanRun.findUnique({
    where: { id: scanRunId },
    include: { target: true },
  });
  if (!run || !run.target) return null;
  await loadTargetExecution(run.target.id);
  return {
    scanRunId,
    targetId: run.target.id,
    userId: run.target.userId,
    host: run.target.host,
    baseUrl: toBaseUrl(run.target.host, run.target.scheme),
  };
}

/** Persist a log line and publish it live for SSE. */
export async function logLine(
  scanRunId: string,
  line: string,
  stream: "STDOUT" | "STDERR" = "STDOUT",
): Promise<void> {
  await prisma.scanLog.create({ data: { scanRunId, line, stream } }).catch(() => {});
  await publishScanLog(scanRunId, {
    line,
    stream,
    createdAt: new Date().toISOString(),
  }).catch(() => {});
}
