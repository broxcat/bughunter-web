"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import ScanLogViewer from "@/components/ScanLogViewer";
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

interface Scope {
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
    </div>
  );
}
