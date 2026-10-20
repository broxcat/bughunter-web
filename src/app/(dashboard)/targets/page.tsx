"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Scope {
  id: string;
  hostPattern: string;
  status: "PENDING" | "APPROVED" | "REVOKED";
}

interface Target {
  id: string;
  host: string;
  label: string | null;
  scope?: Scope | null;
  createdAt: string;
}

export default function TargetsPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [host, setHost] = useState("");
  const [label, setLabel] = useState("");
  const [scopeId, setScopeId] = useState("");

  const approvedScopes = scopes.filter((s) => s.status === "APPROVED");

  async function load() {
    setLoading(true);
    try {
      const [tRes, sRes] = await Promise.all([
        fetch("/api/targets"),
        fetch("/api/scopes"),
      ]);
      if (!tRes.ok) throw new Error(`Failed to load targets (${tRes.status})`);
      if (!sRes.ok) throw new Error(`Failed to load scopes (${sRes.status})`);
      setTargets(await tRes.json());
      setScopes(await sRes.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createTarget(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, scopeId, label: label || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to create target (${res.status})`);
      }
      setHost("");
      setLabel("");
      setScopeId("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create target");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Targets</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          A target can only be created under a scope you have approved.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}

      <form
        onSubmit={createTarget}
        className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-medium">Add a target</h2>
        {approvedScopes.length === 0 ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            You have no approved scopes.{" "}
            <Link href="/scopes" className="underline">
              Declare and approve a scope
            </Link>{" "}
            first.
          </p>
        ) : (
          <>
            <input
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="Host — e.g. api.example.com"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional)"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <select
              required
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="" disabled>
                Select an approved scope…
              </option>
              {approvedScopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.hostPattern}
                </option>
              ))}
            </select>
            <div>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {submitting ? "Adding…" : "Add target"}
              </button>
            </div>
          </>
        )}
      </form>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">Your targets</h2>
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : targets.length === 0 ? (
          <p className="text-sm text-zinc-500">No targets yet.</p>
        ) : (
          <ul className="space-y-2">
            {targets.map((t) => (
              <li
                key={t.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <Link
                  href={`/targets/${t.id}`}
                  className="flex items-center justify-between gap-4"
                >
                  <div>
                    <span className="font-mono text-sm">{t.host}</span>
                    {t.label && (
                      <span className="ml-2 text-sm text-zinc-500">{t.label}</span>
                    )}
                    {t.scope && (
                      <p className="mt-1 text-xs text-zinc-500">
                        scope: {t.scope.hostPattern}
                      </p>
                    )}
                  </div>
                  <span className="text-sm text-zinc-400">View →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
