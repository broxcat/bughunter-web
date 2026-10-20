"use client";

import { useEffect, useState } from "react";
import {
  ScopePolicyFields,
  ScopePolicyView,
  hasPolicy,
  type PolicyValues,
  type ScopePolicyData,
} from "@/components/ScopePolicy";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { POLICY_TEXT_FIELDS } from "@/lib/scopePolicy";

interface Scope extends ScopePolicyData {
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

/** Only filled fields are sent, so a simple scope stays a simple request. */
function policyPayload(v: PolicyValues): Record<string, string> {
  const out: Record<string, string> = {};
  if (v.platform) out.platform = v.platform;
  for (const f of POLICY_TEXT_FIELDS) {
    const t = (v[f] ?? "").trim();
    if (t) out[f] = t;
  }
  return out;
}

function policyValuesOf(s: Scope): PolicyValues {
  const v: PolicyValues = { platform: s.platform ?? "" };
  for (const f of POLICY_TEXT_FIELDS) v[f] = s[f] ?? "";
  return v;
}

function ScopeCard({
  scope,
  onApprove,
  onSaved,
  onError,
}: {
  scope: Scope;
  onApprove: (id: string) => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<PolicyValues>(() => policyValuesOf(scope));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      // On edit, send every field so a cleared textarea clears the stored value
      // (blank strings are stored as null by the API).
      const body: Record<string, string | null> = {
        platform: values.platform || null,
      };
      for (const f of POLICY_TEXT_FIELDS) body[f] = (values[f] ?? "").trim();
      const res = await fetch(`/api/scopes/${scope.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to save policy (${res.status})`);
      }
      setEditing(false);
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save policy");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-foreground">
              {scope.hostPattern}
            </span>
            <Badge tone={STATUS_TONE[scope.status]}>{scope.status}</Badge>
            {scope.platform && <Badge tone="brand">{scope.platform}</Badge>}
          </div>
          {scope.programName && (
            <p className="mt-1 text-sm text-muted">{scope.programName}</p>
          )}
          {scope.justification && (
            <p className="mt-1 text-xs text-subtle">{scope.justification}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide policy" : hasPolicy(scope) ? "Program policy" : "Add policy"}
          </Button>
          {scope.status === "PENDING" && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onApprove(scope.id)}
            >
              Approve
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          {editing ? (
            <>
              <ScopePolicyFields values={values} onChange={setValues} />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={save}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save policy"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setValues(policyValuesOf(scope));
                    setEditing(false);
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <ScopePolicyView policy={scope} />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setValues(policyValuesOf(scope));
                  setEditing(true);
                }}
              >
                Edit policy
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export default function ScopesPage() {
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [hostPattern, setHostPattern] = useState("");
  const [programName, setProgramName] = useState("");
  const [justification, setJustification] = useState("");
  const [policy, setPolicy] = useState<PolicyValues>({});

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
          ...policyPayload(policy),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to create scope (${res.status})`);
      }
      setHostPattern("");
      setProgramName("");
      setJustification("");
      setPolicy({});
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

          <details className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              Program policy{" "}
              <span className="font-normal text-subtle">
                (optional — scope, out of scope, rules of engagement, rewards…)
              </span>
            </summary>
            <div className="mt-3">
              <ScopePolicyFields values={policy} onChange={setPolicy} />
            </div>
          </details>

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
                <ScopeCard
                  scope={s}
                  onApprove={approve}
                  onSaved={load}
                  onError={setError}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
