"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

export type ResearchConsoleCandidate = {
  id: string;
  host: string;
  programName: string;
  recon: string;
  existingSessionId?: string;
  deleting?: boolean;
};

export default function ResearchConsoleManager({ candidates }: { candidates: ResearchConsoleCandidate[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(() => new Set<string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const available = candidates.filter(candidate => !candidate.existingSessionId && !candidate.deleting);
  const existing = candidates.filter(candidate => candidate.existingSessionId || candidate.deleting);

  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function create() {
    if (!selected.size || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/research-consoles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetIds: [...selected] }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Unable to create consoles");
      setSelected(new Set());
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to create consoles");
    } finally {
      setBusy(false);
    }
  }

  async function remove(targetId: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/research-targets/${targetId}/console`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Unable to delete console");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to delete console");
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-6">
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Create consoles</h2>
        <p className="text-sm text-muted">No console is created automatically. Select only the hosts you want to investigate now.</p>
      </div>
      {!available.length ? <p className="text-sm text-muted">No additional authorized host is available.</p> :
        <div className="space-y-2">
          {available.map(candidate => <label key={candidate.id} className="flex items-start gap-3 rounded border border-border p-3">
            <input className="mt-1" type="checkbox" checked={selected.has(candidate.id)} onChange={() => toggle(candidate.id)} />
            <span className="min-w-0">
              <span className="block break-all font-mono text-sm">{candidate.host}</span>
              <span className="block text-xs text-muted">{candidate.programName} · Recon: {candidate.recon}</span>
            </span>
          </label>)}
        </div>}
      <Button type="button" disabled={busy || !selected.size} onClick={() => void create()}>
        {busy ? "Creating…" : `Create consoles (${selected.size})`}
      </Button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>

    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Existing consoles</h2>
        {existing.length > 0 && <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void (async () => {
          setBusy(true); setError("");
          try {
            for (const candidate of existing) {
              const response = await fetch(`/api/research-targets/${candidate.id}/console`, { method: "DELETE" });
              const result = await response.json().catch(() => ({}));
              if (!response.ok) throw new Error(result.error ?? `Unable to delete console for ${candidate.host}`);
            }
            router.refresh();
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Unable to delete consoles");
          } finally {
            setBusy(false);
          }
        })()}>Delete all consoles</Button>}
      </div>
      {!existing.length ? <p className="text-sm text-muted">No research console exists.</p> :
        <ul className="space-y-2">{existing.map(candidate => <li key={candidate.id} className="flex flex-wrap items-center gap-3 rounded border border-border p-3">
          <div className="mr-auto min-w-0">
            <p className="break-all font-mono text-sm">{candidate.host}</p>
            <p className="text-xs text-muted">{candidate.deleting ? "Deletion pending" : "Ready"}</p>
          </div>
          {!candidate.deleting && <Link className="ui-btn" data-variant="primary" href={`/research/${candidate.id}`}>Open</Link>}
          <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void remove(candidate.id)}>
            {candidate.deleting ? "Retry delete" : "Delete"}
          </Button>
        </li>)}</ul>}
    </section>
  </div>;
}
