// Shared scanner context + helpers used by the vuln-class modules.
//
// Scanners receive only a scanRunId (keeping runHunt's signature stable so the
// QUEUE worker needs no change); they load the rest of their context — targetId,
// userId, host — from the DB here. Findings are persisted with their target +
// scan run; log lines go to ScanLog + the live SSE bus.

import { prisma } from "@/lib/prisma";
import { publishScanLog } from "@/server/queue/logBus";
import { triageFinding } from "@/server/brain";
import type { Severity, FindingConfidence } from "@prisma/client";

// Cap on inline LLM enrichment per finding. triageFinding uses the client's
// default 120s×retries budget; a slow/unreachable provider must never stall the
// scan, so we race it against this timeout and persist regardless. 20s leaves
// margin for a cold model while keeping a finding from ever blocking for long.
const ENRICH_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

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

export interface NewFinding {
  title: string;
  vulnClass: string;
  severity: Severity;
  /**
   * Confidence axis, independent of severity. PROVEN = direct evidence in the
   * response/behavior; CANDIDATE = needs manual/out-of-band confirmation. The
   * scanner that creates the finding sets this; defaults to CANDIDATE if omitted.
   */
  confidence?: FindingConfidence;
  description?: string;
  location?: string;
  evidence?: string;
  /** OOB correlation token (set by the SSRF scanner); matches OobHit.token. */
  oobToken?: string;
}

/** Create an UNVALIDATED Finding on the context's target and log it. */
export async function recordFinding(
  ctx: ScanContext,
  f: NewFinding,
): Promise<void> {
  // Best-effort LLM enrichment before persist (the active provider, if any).
  // Two hard rules, both preserved here:
  //  - it NEVER changes the finding's severity — scanners pin it deliberately
  //    for epistemic honesty (a triage model must not inflate an INFO candidate);
  //    a differing suggestion is kept as an advisory note only.
  //  - it NEVER touches gateStatus — findings always start UNVALIDATED and must
  //    pass the manual 7-Question Gate.
  // Bounded by ENRICH_TIMEOUT_MS so a slow/unreachable provider can't stall scans.
  let description = f.description;
  let vulnClass = f.vulnClass;
  try {
    const s = await withTimeout(triageFinding(ctx.userId, f), ENRICH_TIMEOUT_MS, {});
    if (!vulnClass && s.vulnClass) vulnClass = s.vulnClass;
    if (s.summary) {
      const sevNote =
        s.suggestedSeverity && s.suggestedSeverity !== f.severity
          ? ` (AI-suggested severity: ${s.suggestedSeverity} — advisory; scanner severity ${f.severity} kept)`
          : "";
      description = `${f.description ? f.description + "\n\n" : ""}AI triage: ${s.summary}${sevNote}`;
    }
  } catch {
    // Enrichment is strictly best-effort; never block a finding on it.
  }

  await prisma.finding.create({
    data: {
      targetId: ctx.targetId,
      scanRunId: ctx.scanRunId,
      title: f.title,
      vulnClass,
      severity: f.severity,
      confidence: f.confidence ?? "CANDIDATE",
      description,
      location: f.location,
      evidence: f.evidence,
      oobToken: f.oobToken,
      gateStatus: "UNVALIDATED",
    },
  });
  await logLine(
    ctx.scanRunId,
    `[+] Finding: ${f.title} [${f.severity}]${f.location ? ` @ ${f.location}` : ""}`,
  );
}
