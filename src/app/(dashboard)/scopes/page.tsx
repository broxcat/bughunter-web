"use client";

import { useEffect, useState } from "react";

interface Scope {
  id: string;
  hostPattern: string;
  programName: string | null;
  justification: string | null;
  status: "PENDING" | "APPROVED" | "REVOKED";
  createdAt: string;
}

const STATUS_STYLE: Record<Scope["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  REVOKED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

export default function ScopesPage() {
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [hostPattern, setHostPattern] = useState("");
  const [programName, setProgramName] = useState("");
  const [justification, setJustification] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/scopes");
      if (!res.ok) throw new Error(`Failed to load scopes (${res.status})`);
      setScopes(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scopes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createScope(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/scopes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostPattern,
          programName: programName || undefined,
          justification: justification || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to create scope (${res.status})`);
      }
      setHostPattern("");
      setProgramName("");
      setJustification("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create scope");
    } finally {
      setSubmitting(false);
    }
  }

  async function approve(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/scopes/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to approve (${res.status})`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scopes</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          A scope is your authorization to test. Nothing is scanned until you
          approve it yourself.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}

      <form
        onSubmit={createScope}
        className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-medium">Declare a scope</h2>
        <input
          required
          value={hostPattern}
          onChange={(e) => setHostPattern(e.target.value)}
          placeholder="Host pattern — e.g. *.example.com"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <input
          value={programName}
          onChange={(e) => setProgramName(e.target.value)}
          placeholder="Program name (optional)"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Justification — bug bounty program URL or engagement reference (optional)"
          rows={2}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {submitting ? "Declaring…" : "Declare scope"}
          </button>
        </div>
      </form>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">Your scopes</h2>
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : scopes.length === 0 ? (
          <p className="text-sm text-zinc-500">No scopes yet.</p>
        ) : (
          <ul className="space-y-2">
            {scopes.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{s.hostPattern}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status]}`}
                    >
                      {s.status}
                    </span>
                  </div>
                  {s.programName && (
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      {s.programName}
                    </p>
                  )}
                  {s.justification && (
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                      {s.justification}
                    </p>
                  )}
                </div>
                {s.status === "PENDING" && (
                  <button
                    onClick={() => approve(s.id)}
                    className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
                  >
                    Approve
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
