"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

export default function ScanCancelButton({ scanRunId, status, requested, onRequested }: { scanRunId: string; status: string; requested?: boolean; onRequested?: (at: string) => void }) {
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState("");
  if (!["QUEUED", "RUNNING"].includes(status)) return null;
  async function cancel() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/scan-runs/${encodeURIComponent(scanRunId)}/cancel`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to request cancellation");
      setSent(true); onRequested?.(body.cancelRequestedAt ?? new Date().toISOString());
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <span className="inline-flex flex-col gap-1"><Button size="sm" variant="secondary" disabled={busy || requested || sent} onClick={() => void cancel()}>{requested || sent ? "Cancellation requested" : busy ? "Sending…" : "Cancel scan"}</Button>{error && <span role="alert" className="text-sm">{error}</span>}</span>;
}
