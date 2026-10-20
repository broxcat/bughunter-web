"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// Mirrors the SSE route's log payload.
type LogEntry = { line: string; stream: "STDOUT" | "STDERR"; createdAt: string };

const TERMINAL = new Set<string>(["COMPLETED", "FAILED", "CANCELLED"]);

// Status → semantic Badge tone (same scale as the rest of the app):
// green when done, red when failed, amber for every live/transitional state.
function statusTone(status: string): BadgeTone {
  if (status === "COMPLETED") return "passed";
  if (status === "FAILED") return "killed";
  return "medium";
}

export default function ScanLogViewer({ scanRunId }: { scanRunId: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string>("CONNECTING");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Reset when the run changes.
    setLogs([]);
    setStatus("CONNECTING");

    const es = new EventSource(`/api/scan-runs/${scanRunId}/stream`);

    es.addEventListener("open", () => {
      // The server only emits an explicit status event once the run is terminal,
      // so until then we show a live/streaming state (rendered amber).
      setStatus((prev) => (TERMINAL.has(prev) ? prev : "RUNNING"));
    });

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
        const { status: next } = JSON.parse(
          (event as MessageEvent).data,
        ) as { status: string };
        setStatus(next);
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
        <Badge tone={statusTone(status)} mono>
          {status}
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
