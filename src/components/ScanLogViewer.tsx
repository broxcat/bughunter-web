"use client";

import ScanCancelButton from "./ScanCancelButton";
import ScanSummaryPanel from "./ScanSummaryPanel";
import { useEffect, useRef, useState } from "react";
import { scanPresentation } from "@/lib/scanPresentation";
import { Badge } from "@/components/ui/Badge";

// Mirrors the SSE route's log payload.
type LogEntry = { line: string; stream: "STDOUT" | "STDERR"; createdAt: string };

const TERMINAL = new Set<string>(["COMPLETED", "FAILED", "CANCELLED"]);

type Stage={name:string;state:string;reason:string|null};
type ScanLogProps = { scanRunId: string; stages?: Stage[]; cancelled?: boolean; showReconSummary?: boolean };
export default function ScanLogViewer({ scanRunId, stages, cancelled, showReconSummary = Boolean(stages) }: ScanLogProps) {
  return <ScanLogSession key={scanRunId} scanRunId={scanRunId} stages={stages} cancelled={cancelled} showReconSummary={showReconSummary} />;
}
function ScanLogSession({ scanRunId, stages, cancelled, showReconSummary }: ScanLogProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string>("CONNECTING");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [dispatch, setDispatch] = useState<string | null>(null);
  const [cancelRequestedAt, setCancelRequestedAt] = useState<string | null>(null);
  const [execution, setExecution] = useState<{ state: string } | null>(null);
  const presentation = scanPresentation(status, outcome, dispatch, execution?.state, Boolean(cancelRequestedAt));
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/scan-runs/${scanRunId}/stream`);

    es.addEventListener("log", (event) => {
      try {
        const entry = JSON.parse((event as MessageEvent).data) as LogEntry;
        setLogs((prev) => [...prev.slice(-1999), entry]);
      } catch {
        // ignore a malformed frame
      }
    });

    es.addEventListener("status", (event) => {
      try {
        const { status: next, outcome: nextOutcome, dispatch: nextDispatch, cancelRequestedAt: cancelledAt, execution: nextExecution } = JSON.parse(
          (event as MessageEvent).data,
        ) as { status: string; outcome?: string | null; dispatch?: string | null; cancelRequestedAt?: string | null; execution?: { state: string } | null };
        setStatus(next);
        setOutcome(nextOutcome ?? null);
        setDispatch(nextDispatch ?? null);
        setCancelRequestedAt(cancelledAt ?? null);
        setExecution(nextExecution ?? null);
        if (TERMINAL.has(next)) {
          es.close();
        }
      } catch {
        // ignore a malformed frame
      }
    });

    es.addEventListener("error", () => {
      // EventSource auto-reconnects while open. If it has given up (CLOSED) and
      // we never reached a terminal status, surface the disconnect.
      if (es.readyState === EventSource.CLOSED) {
        setStatus((prev) => (TERMINAL.has(prev) ? prev : "DISCONNECTED"));
      }
    });

    return () => {
      es.close();
    };
  }, [scanRunId]);

  // Auto-scroll to the newest line.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [logs]);

  // Normal Recon controls follow the app theme. Raw output stays secondary;
  // stream labels, not colour, distinguish STDERR from STDOUT.
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-surface-2">
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
        <span className="text-sm font-medium text-muted">
          {stages ? 'Recon console' : 'Scan output'}
        </span>
        <div className="flex items-center gap-2"><Badge tone={presentation.tone} mono>{presentation.label}</Badge><ScanCancelButton scanRunId={scanRunId} status={status} requested={Boolean(cancelRequestedAt)} onRequested={setCancelRequestedAt} /></div>
      </div>
      {stages&&<ol className="space-y-1 border-b border-border px-4 py-3 text-sm text-foreground">{stages.map(s=><li key={s.name} className="flex flex-wrap gap-x-3"><span className="min-w-48">{s.name}</span><span>{cancelled&&['PENDING','RUNNING','SKIPPED'].includes(s.state)?'Cancelled':s.state.toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase())}</span>{s.reason&&['PARTIAL','BLOCKED','FAILED','SKIPPED','SKIPPED_UNSUPPORTED','SKIPPED_NOT_APPLICABLE','COMPLETED_WITH_FALLBACK','CANCELLED'].includes(s.state)&&<span className="basis-full text-muted">{s.reason}</span>}</li>)}</ol>}
      {execution?.state === "INTERRUPTED" && <p role="status" className="px-4 py-2 text-sm text-muted">Execution interrupted · automatic retry disabled.</p>}
      {showReconSummary && TERMINAL.has(status) && <details className="border-t border-border"><summary className="px-4 py-3 text-sm">Recon observations</summary><ScanSummaryPanel scanRunId={scanRunId} /></details>}
      <p className="px-4 py-1 text-xs text-muted">Displays the most recent 2,000 received log entries.</p>
      <details className="border-t border-border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Raw scan output ({logs.length} received lines)</summary>
      <div className="max-h-96 overflow-y-auto bg-surface-2 px-4 py-3 font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <p className="text-muted">Waiting for scan output…</p>
        ) : (
          logs.map((entry, i) => (
            <pre
              key={i}
              className="whitespace-pre-wrap break-words text-foreground"
            >
              <span className="text-muted">[{entry.stream}] </span>{entry.line}
            </pre>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      </details>
    </div>
  );
}
