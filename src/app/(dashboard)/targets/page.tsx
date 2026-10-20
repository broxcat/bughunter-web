"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Targets
        </h1>
        <p className="mt-1 text-sm text-muted">
          A target can only be created under a scope you have approved.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-foreground"
        >
          <Badge tone="critical">Error</Badge>
          <span>{error}</span>
        </div>
      )}

      <Card className="p-4">
        <form onSubmit={createTarget} className="grid gap-3">
          <h2 className="text-sm font-medium text-foreground">Add a target</h2>
          {approvedScopes.length === 0 ? (
            <p className="text-sm text-muted">
              You have no approved scopes.{" "}
              <Link href="/scopes" className="text-brand underline">
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
                className="rounded-md border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-foreground placeholder:text-subtle"
              />
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (optional)"
                className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
              />
              <select
                required
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
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
                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting ? "Adding…" : "Add target"}
                </Button>
              </div>
            </>
          )}
        </form>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Your targets</h2>
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : targets.length === 0 ? (
          <p className="text-sm text-muted">No targets yet.</p>
        ) : (
          <ul className="space-y-2">
            {targets.map((t) => (
              <li key={t.id}>
                <Card className="p-4 transition-colors hover:bg-surface-2">
                  <Link
                    href={`/targets/${t.id}`}
                    className="flex items-center justify-between gap-4"
                  >
                    <div>
                      <span className="font-mono text-sm text-foreground">
                        {t.host}
                      </span>
                      {t.label && (
                        <span className="ml-2 text-sm text-muted">{t.label}</span>
                      )}
                      {t.scope && (
                        <p className="mt-1 font-mono text-xs text-subtle">
                          scope: {t.scope.hostPattern}
                        </p>
                      )}
                    </div>
                    <span className="text-sm text-brand">View →</span>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
