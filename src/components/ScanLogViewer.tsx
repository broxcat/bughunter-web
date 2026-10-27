"use client";

import { useEffect, useRef, useState } from "react";
import { scanPresentation } from "@/lib/scanPresentation";
import { Badge } from "@/components/ui/Badge";

// Mirrors the SSE route's log payload.
type LogEntry = { line: string; stream: "STDOUT" | "STDERR"; createdAt: string };

const TERMINAL = new Set<string>(["COMPLETED", "FAILED", "CANCELLED"]);

export default function ScanLogViewer({ scanRunId }: { scanRunId: string }) {
  return <ScanLogSession key={scanRunId} scanRunId={scanRunId} />;
}
function ScanLogSession({ scanRunId }: { scanRunId: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string>("CONNECTING");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [dispatch, setDispatch] = useState<string | null>(null);
  const presentation = scanPresentation(status, outcome, dispatch);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/scan-runs/${scanRunId}/stream`);

    es.addEventListener("log", (event) => {
      try {
        const entry = JSON.parse((event as MessageEvent).data) as LogEntry;
        setLogs((prev) => [...prev, entry]);
      } catch {
        // ignore a malformed frame
      }
    });

    es.addEventListener("status", (event) => {
      try {
        const { status: next, outcome: nextOutcome, dispatch: nextDispatch } = JSON.parse(
          (event as MessageEvent).data,
        ) as { status: string; outcome?: string | null; dispatch?: string | null };
        setStatus(next);
        setOutcome(nextOutcome ?? null);
        setDispatch(nextDispatch ?? null);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Deliberate terminal aesthetic: this panel stays dark in BOTH themes, so the
  // log well reads like a real console regardless of the app's light/dark mode.
  // These fixed neutral/green/red tones are intentional for the terminal look
  // and are kept separate from the themeable chrome tokens.
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4 py-2">
        <span className="font-mono text-xs font-medium uppercase tracking-wide text-neutral-400">
          Scan output
        </span>
        <Badge tone={presentation.tone} mono>
          {presentation.label}
        </Badge>
      </div>
      <div className="h-96 overflow-y-auto bg-neutral-950 px-4 py-3 font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <p className="text-neutral-600">Waiting for scan output…</p>
        ) : (
          logs.map((entry, i) => (
            <pre
              key={i}
              className={`whitespace-pre-wrap break-words ${
                entry.stream === "STDERR" ? "text-red-400" : "text-emerald-200"
              }`}
            >
              {entry.line}
            </pre>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
