"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import ScanLogViewer from "@/components/ScanLogViewer";
import {
  ScopePolicyView,
  hasPolicy,
  type ScopePolicyData,
} from "@/components/ScopePolicy";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type ScanType = "RECON" | "HUNT" | "VALIDATE";

interface ScanRun {
  id: string;
  type: ScanType;
  status: string;
  jobId: string | null;
  createdAt: string;
}

interface Scope extends ScopePolicyData {
  id: string;
  hostPattern: string;
  status: string;
}

interface TargetDetail {
  id: string;
  host: string;
  label: string | null;
  scope: Scope;
  scanRuns: ScanRun[];
  findings: { id: string }[];
}

// A saved TARGET credential as surfaced to the client: booleans only, NEVER the
// decrypted cookies/token (same rule as hasApiKey on AI providers).
interface TargetCredential {
  id: string;
  label: string;
  createdAt: string;
  hasCookies: boolean;
  hasToken: boolean;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  QUEUED: "neutral",
  RUNNING: "info",
  COMPLETED: "passed",
  FAILED: "killed",
  CANCELLED: "unvalidated",
};

export default function TargetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [target, setTarget] = useState<TargetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<ScanType | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  // Target-credentials section state (cookies/bearer token FOR THE TARGET app).
  const [credentials, setCredentials] = useState<TargetCredential[]>([]);
  const [credLabel, setCredLabel] = useState("");
  const [credCookies, setCredCookies] = useState("");
  const [credToken, setCredToken] = useState("");
  const [savingCred, setSavingCred] = useState(false);
  const [deletingCred, setDeletingCred] = useState<string | null>(null);
  const [credError, setCredError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/targets/${id}`);
      if (!res.ok) throw new Error(`Failed to load target (${res.status})`);
      setTarget(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load target");
    } finally {
      setLoading(false);
    }
  }

  async function loadCredentials() {
    try {
      const res = await fetch(`/api/targets/${id}/credentials`);
      if (!res.ok) throw new Error(`Failed to load credentials (${res.status})`);
      const j = await res.json();
      setCredentials(j.credentials ?? []);
    } catch (e) {
      setCredError(
        e instanceof Error ? e.message : "Failed to load credentials",
      );
    }
  }

  useEffect(() => {
    load();
    loadCredentials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveCredential(e: React.FormEvent) {
    e.preventDefault();
    setCredError(null);

    const label = credLabel.trim();
    const cookies = credCookies.trim();
    const bearerToken = credToken.trim();
    if (!label) {
      setCredError("A label is required.");
      return;
    }
    if (!cookies && !bearerToken) {
      setCredError("Provide session cookies and/or a bearer token.");
      return;
    }

    // Accept the cookies textarea as either JSON ({"k":"v"}) or a raw cookie
    // string ("k=v; k2=v2"); the API parses a raw string into a map.
    let cookiesPayload: Record<string, string> | string | undefined;
    if (cookies) {
      if (cookies.startsWith("{")) {
        try {
          cookiesPayload = JSON.parse(cookies);
        } catch {
          setCredError("Cookies look like JSON but failed to parse.");
          return;
        }
      } else {
        cookiesPayload = cookies;
      }
    }

    setSavingCred(true);
    try {
      const res = await fetch(`/api/targets/${id}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          ...(cookiesPayload !== undefined ? { cookies: cookiesPayload } : {}),
          ...(bearerToken ? { bearerToken } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to save credential (${res.status})`);
      }
      setCredLabel("");
      setCredCookies("");
      setCredToken("");
      await loadCredentials();
    } catch (e) {
      setCredError(
        e instanceof Error ? e.message : "Failed to save credential",
      );
    } finally {
      setSavingCred(false);
    }
  }

  async function deleteCredential(credentialId: string) {
    setCredError(null);
    setDeletingCred(credentialId);
    try {
      const res = await fetch(
        `/api/targets/${id}/credentials?credentialId=${encodeURIComponent(credentialId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to delete credential (${res.status})`);
      }
      await loadCredentials();
    } catch (e) {
      setCredError(
        e instanceof Error ? e.message : "Failed to delete credential",
      );
    } finally {
      setDeletingCred(null);
    }
  }

  async function startScan(type: ScanType) {
    setStarting(type);
    setError(null);
    try {
      const res = await fetch("/api/scan-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: id, type }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to start scan (${res.status})`);
      }
      const run = await res.json();
      await load();
      setOpenRun(run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start scan");
    } finally {
      setStarting(null);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (error && !target)
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-foreground"
      >
        <Badge tone="critical">Error</Badge>
        <span>{error}</span>
      </div>
    );
  if (!target) return <p className="text-sm text-muted">Not found.</p>;

  const scopeApproved = target.scope.status === "APPROVED";

  return (
    <div className="space-y-8">
      <div>
        <Link href="/targets" className="text-sm text-muted hover:text-foreground">
          ← Targets
        </Link>
        <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight text-foreground">
          {target.host}
        </h1>
        {target.label && <p className="text-sm text-muted">{target.label}</p>}
        <p className="mt-1 flex items-center gap-2 text-xs text-subtle">
          <span className="font-mono">scope {target.scope.hostPattern}</span>
          <Badge tone={STATUS_TONE[target.scope.status] ?? "neutral"}>
            {target.scope.status}
          </Badge>
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

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() => startScan("RECON")}
          disabled={!scopeApproved || starting !== null}
        >
          {starting === "RECON" ? "Starting…" : "Run recon"}
        </Button>
        <Button
          variant="primary"
          onClick={() => startScan("HUNT")}
          disabled={!scopeApproved || starting !== null}
        >
          {starting === "HUNT" ? "Starting…" : "Run hunt"}
        </Button>
        <div className="ml-auto flex gap-4 text-sm">
          <Link
            href={`/targets/${id}/findings`}
            className="text-brand hover:text-brand-hover"
          >
            Findings ({target.findings.length})
          </Link>
          <Link
            href={`/targets/${id}/report`}
            className="text-brand hover:text-brand-hover"
          >
            Report
          </Link>
        </div>
      </div>

      {!scopeApproved && (
        <p className="text-sm text-muted">
          This target&apos;s scope is not approved, so scans are disabled.
        </p>
      )}

      {/* Program policy reminder — informational only; scan authorization is
          decided by the scope status above, never by this text. */}
      {hasPolicy(target.scope) && (
        <details
          open={Boolean(
            target.scope.outOfScope?.trim() ||
              target.scope.rulesOfEngagement?.trim(),
          )}
          className="rounded-md border border-border bg-surface-2 px-4 py-3"
        >
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Program policy{" "}
            <span className="font-normal text-subtle">
              — review Out of Scope and Rules of Engagement before testing
            </span>
          </summary>
          <div className="mt-3">
            <ScopePolicyView policy={target.scope} emphasisFirst />
          </div>
        </details>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Scan runs</h2>
        {target.scanRuns.length === 0 ? (
          <p className="text-sm text-muted">No scan runs yet.</p>
        ) : (
          <ul className="space-y-2">
            {target.scanRuns.map((run) => (
              <li key={run.id}>
                <Card className="overflow-hidden">
                  <button
                    onClick={() =>
                      setOpenRun((cur) => (cur === run.id ? null : run.id))
                    }
                    className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-surface-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">
                        {run.type}
                      </span>
                      <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>
                        {run.status}
                      </Badge>
                    </div>
                    <span className="text-xs text-subtle">
                      {openRun === run.id ? "Hide logs" : "View live logs"}
                    </span>
                  </button>
                  {openRun === run.id && (
                    <div className="border-t border-border p-4">
                      <ScanLogViewer scanRunId={run.id} />
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        Target credentials — cookies / bearer token FOR THE TARGET you are
        testing (the bug-bounty program's app), NEVER your bughunter-web login.
        Stored encrypted server-side; only presence booleans are ever returned.
        Compliance caveat: the operator is responsible for ensuring these test
        accounts and their use comply with that program's rules of engagement.
      */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">
          Target credentials
        </h2>
        <Card className="space-y-5 p-4">
          <div className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-xs text-muted">
            These are credentials for the <strong>TARGET</strong> you are
            testing (the bug-bounty program&apos;s app) — never your
            bughunter-web login. They let the authenticated scanners act as a
            real test account. You are responsible for ensuring these test
            accounts and their use comply with that program&apos;s rules.
          </div>

          {credError && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-foreground"
            >
              <Badge tone="critical">Error</Badge>
              <span>{credError}</span>
            </div>
          )}

          <form onSubmit={saveCredential} className="space-y-3">
            <div className="space-y-1">
              <label
                htmlFor="cred-label"
                className="block text-xs font-medium text-foreground"
              >
                Label
              </label>
              <input
                id="cred-label"
                type="text"
                value={credLabel}
                onChange={(e) => setCredLabel(e.target.value)}
                placeholder="e.g. test-user-A session"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="cred-cookies"
                className="block text-xs font-medium text-foreground"
              >
                Session cookies{" "}
                <span className="text-subtle">
                  (JSON {`{"name":"value"}`} or a cookie string k=v; k2=v2)
                </span>
              </label>
              <textarea
                id="cred-cookies"
                value={credCookies}
                onChange={(e) => setCredCookies(e.target.value)}
                rows={3}
                placeholder={`{"session":"abc123"}  or  session=abc123; csrf=xyz`}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="cred-token"
                className="block text-xs font-medium text-foreground"
              >
                Bearer token{" "}
                <span className="text-subtle">
                  (optional; sent as Authorization: Bearer …)
                </span>
              </label>
              <input
                id="cred-token"
                type="text"
                value={credToken}
                onChange={(e) => setCredToken(e.target.value)}
                placeholder="eyJhbGciOi…"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle"
              />
            </div>
            <Button type="submit" variant="primary" disabled={savingCred}>
              {savingCred ? "Saving…" : "Add credential"}
            </Button>
          </form>

          <div className="space-y-2">
            {credentials.length === 0 ? (
              <p className="text-sm text-muted">No credentials saved yet.</p>
            ) : (
              <ul className="space-y-2">
                {credentials.map((cred) => (
                  <li
                    key={cred.id}
                    className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {cred.label}
                      </span>
                      {cred.hasCookies && <Badge tone="info">cookies</Badge>}
                      {cred.hasToken && <Badge tone="brand">token</Badge>}
                      <span className="text-xs text-subtle">
                        {new Date(cred.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => deleteCredential(cred.id)}
                      disabled={deletingCred === cred.id}
                    >
                      {deletingCred === cred.id ? "Removing…" : "Delete"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
