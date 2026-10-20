// Shared scanner context + helpers used by the vuln-class modules.
//
// Scanners receive only a scanRunId (keeping runHunt's signature stable so the
// QUEUE worker needs no change); they load the rest of their context — targetId,
// userId, host — from the DB here. Findings are persisted with their target +
// scan run; log lines go to ScanLog + the live SSE bus.

import { prisma } from "@/lib/prisma";
import { publishScanLog } from "@/server/queue/logBus";
import type { Severity } from "@prisma/client";

export interface ScanContext {
  scanRunId: string;
  targetId: string;
  userId: string;
  /** The raw host as stored on the Target. */
  host: string;
  /** Normalized base URL (scheme guaranteed, no trailing slash). */
  baseUrl: string;
}

/** Normalize a stored host into a base URL (default https, strip trailing /). */
export function toBaseUrl(host: string): string {
  const h = host.trim();
  const withScheme = /^https?:\/\//i.test(h) ? h : `https://${h}`;
  return withScheme.replace(/\/+$/, "");
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
  return {
    scanRunId,
    targetId: run.target.id,
    userId: run.target.userId,
    host: run.target.host,
    baseUrl: toBaseUrl(run.target.host),
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

export interface NewFinding {
  title: string;
  vulnClass: string;
  severity: Severity;
  description?: string;
  location?: string;
  evidence?: string;
}

/** Create an UNVALIDATED Finding on the context's target and log it. */
export async function recordFinding(
  ctx: ScanContext,
  f: NewFinding,
): Promise<void> {
  await prisma.finding.create({
    data: {
      targetId: ctx.targetId,
      scanRunId: ctx.scanRunId,
      title: f.title,
      vulnClass: f.vulnClass,
      severity: f.severity,
      description: f.description,
      location: f.location,
      evidence: f.evidence,
      gateStatus: "UNVALIDATED",
    },
  });
  await logLine(
    ctx.scanRunId,
    `[+] Finding: ${f.title} [${f.severity}]${f.location ? ` @ ${f.location}` : ""}`,
  );
}
