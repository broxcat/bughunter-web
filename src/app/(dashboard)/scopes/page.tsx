"use client";

import { useEffect, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface Scope {
  id: string;
  hostPattern: string;
  programName: string | null;
  justification: string | null;
  status: "PENDING" | "APPROVED" | "REVOKED";
  createdAt: string;
}

const STATUS_TONE: Record<Scope["status"], BadgeTone> = {
  PENDING: "unvalidated",
  APPROVED: "passed",
  REVOKED: "killed",
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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Scopes
        </h1>
        <p className="mt-1 text-sm text-muted">
          A scope is your authorization to test. Nothing is scanned until you
          approve it yourself.
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
        <form onSubmit={createScope} className="grid gap-3">
          <h2 className="text-sm font-medium text-foreground">Declare a scope</h2>
          <input
            required
            value={hostPattern}
            onChange={(e) => setHostPattern(e.target.value)}
            placeholder="Host pattern — e.g. *.example.com"
            className="rounded-md border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-foreground placeholder:text-subtle"
          />
          <input
            value={programName}
            onChange={(e) => setProgramName(e.target.value)}
            placeholder="Program name (optional)"
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
          />
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Justification — bug bounty program URL or engagement reference (optional)"
            rows={2}
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
          />
          <div>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Declaring…" : "Declare scope"}
            </Button>
          </div>
        </form>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Your scopes</h2>
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : scopes.length === 0 ? (
          <p className="text-sm text-muted">No scopes yet.</p>
        ) : (
          <ul className="space-y-2">
            {scopes.map((s) => (
              <li key={s.id}>
                <Card className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-foreground">
                      {s.hostPattern}
                    </span>
                    <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                  </div>
                  {s.programName && (
                    <p className="mt-1 text-sm text-muted">{s.programName}</p>
                  )}
                  {s.justification && (
                    <p className="mt-1 text-xs text-subtle">{s.justification}</p>
                  )}
                  </div>
                  {s.status === "PENDING" && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="shrink-0"
                      onClick={() => approve(s.id)}
                    >
                      Approve
                    </Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
