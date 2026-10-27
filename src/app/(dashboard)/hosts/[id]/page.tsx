"use client";

import Link from "next/link";
import TargetAuthentication from "@/components/TargetAuthentication";
import CreateResearchButton from "@/components/CreateResearchButton";
import { use, useEffect, useRef, useState } from "react";
import ScanCancelButton from "@/components/ScanCancelButton";
import ScanLogViewer from "@/components/ScanLogViewer";
import {
  ScopePolicyView,
  hasPolicy,
  type ScopePolicyData,
} from "@/components/ScopePolicy";
import { scanPresentation } from "@/lib/scanPresentation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type ScanType = "RECON" | "HUNT" | "VALIDATE";

interface ScanRun {
  id: string;
  type: ScanType;
  status: string;
  outcome: string | null;
  cancelRequestedAt?: string | null;
  execution?: { state: string } | null;
  dispatch?: string | null;
  requiredUserAgent: string | null;
  createdAt: string;
}

interface Scope extends ScopePolicyData {
  id: string;
  hostPattern: string;
  status: string;
}

interface TargetDetail {
  scanRejection: string | null;
  program: { id: string; companyName: string; requiredUserAgent: string } | null;
  id: string;
  host: string;
  label: string | null;
  scope: Scope;
  scanRuns: ScanRun[];
  findings: { id: string }[];
}

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
  const pendingRequest = useRef<{ body: string; key: string } | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

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

  useEffect(() => {
    fetch(`/api/targets/${id}`).then(async t => {
      if (!t.ok) throw new Error("Host not found"); setTarget(await t.json());
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [id]);

  async function startScan(type: ScanType) {
    setStarting(type);
    setError(null);
    try {
      const body = JSON.stringify({ targetId: id, type });
      if (pendingRequest.current?.body !== body) pendingRequest.current = { body, key: crypto.randomUUID() };
      const res = await fetch("/api/scan-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": pendingRequest.current.key },
        body,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to start scan (${res.status})`);
      }
      const run = await res.json();
      pendingRequest.current = null;
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

  const scopeApproved = !target.scanRejection;

  return (
    <div className="space-y-8">
      <div>
        <Link href={target.program ? `/scopes/${target.program.id}` : "/scopes"} className="text-sm text-muted hover:text-foreground">
          ← Scope
        </Link>
        <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight text-foreground">
          {target.program?.companyName && <span className="block text-sm font-sans">{target.program.companyName}</span>}{target.host}
        </h1>
        {target.label && <p className="text-sm text-muted">{target.label}</p>}
        <p className="mt-1 text-sm text-muted">{scopeApproved ? "Active scope host" : "History — unavailable for new scans"}</p>
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
        <CreateResearchButton targetId={id} disabled={!scopeApproved} />
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
          {target.scanRejection}
        </p>
      )}

      {target.program && <p className="text-sm">Required User-Agent: <code>{target.program.requiredUserAgent}</code></p>}
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
                        {run.type === "HUNT" ? <Link href={`/hunt/${run.id}`} className="text-brand">Legacy Hunt — history</Link> : run.type}
                      </span>
                      <Badge tone={scanPresentation(run.status, run.outcome, run.dispatch, run.execution?.state, Boolean(run.cancelRequestedAt)).tone}>
                        {scanPresentation(run.status, run.outcome, run.dispatch, run.execution?.state, Boolean(run.cancelRequestedAt)).label}
                      </Badge>
                      {run.type === "RECON" && <ScanCancelButton scanRunId={run.id} status={run.status} requested={Boolean(run.cancelRequestedAt)} onRequested={() => void load()} />}
                      {run.execution?.state === "INTERRUPTED" && <span className="text-sm text-muted">Relance automatique désactivée.</span>}
                    </div>
                    <span className="text-xs text-subtle">
                      {openRun === run.id ? "Hide logs" : "View live logs"}
                    </span>
                  </button>
                  {openRun === run.id && (
                    <div className="border-t border-border p-4">
                      {run.requiredUserAgent && <p>User-Agent used: <code>{run.requiredUserAgent}</code></p>}
                      <ScanLogViewer scanRunId={run.id} />
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <TargetAuthentication targetId={id} disabled={!scopeApproved} />
    </div>
  );
}
