"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

type Candidate = { host: string; responsive: boolean };

export default function ReconDiscoveredHosts({ programId, candidates }: { programId: string; candidates: Candidate[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(() => new Set<string>());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (!candidates.length) {
    return <p className="text-sm text-muted">No newly discovered host needs scope review.</p>;
  }

  const toggle = (host: string) => {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(host)) next.delete(host); else next.add(host);
      return next;
    });
  };

  async function addSelected() {
    if (!selected.size || busy) return;
    setBusy(true); setMessage(""); setError("");
    let added = 0;
    const failures: string[] = [];
    for (const candidate of candidates.filter(item => selected.has(item.host))) {
      try {
        const response = await fetch(`/api/programs/${programId}/assets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            value: candidate.host,
            type: candidate.responsive ? "WEB_APPLICATION" : "OTHER",
            assetValue: "MEDIUM",
          }),
        });
        if (response.status === 409) continue;
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        added++;
      } catch (failure) {
        failures.push(`${candidate.host}: ${failure instanceof Error ? failure.message : "unable to add"}`);
      }
    }
    if (added) {
      setMessage(`${added} discovered host${added === 1 ? "" : "s"} added to target scope.`);
      router.refresh();
    }
    if (failures.length) setError(failures.join(" · "));
    setBusy(false);
  }

  return <div className="space-y-3">
    <p className="text-sm text-muted">Recon observations do not grant authorization. Select only hosts that are explicitly allowed by the program.</p>
    <div className="space-y-2">
      {candidates.map(candidate => <label key={candidate.host} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={selected.has(candidate.host)} onChange={() => toggle(candidate.host)} />
        <span className="break-all font-mono">{candidate.host}</span>
        {candidate.responsive && <span className="text-xs text-muted">responsive web host</span>}
      </label>)}
    </div>
    <Button type="button" disabled={busy || !selected.size} onClick={() => void addSelected()}>
      {busy ? "Adding…" : `Add selected to scope (${selected.size})`}
    </Button>
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}
