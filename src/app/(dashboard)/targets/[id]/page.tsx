"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import ScanLogViewer from "@/components/ScanLogViewer";

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

const STATUS_STYLE: Record<string, string> = {
  QUEUED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  RUNNING: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  FAILED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  CANCELLED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
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

  if (loading) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (error && !target)
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
        {error}
      </div>
    );
  if (!target) return <p className="text-sm text-zinc-500">Not found.</p>;

  const scopeApproved = target.scope.status === "APPROVED";

  return (
    <div className="space-y-8">
      <div>
        <Link href="/targets" className="text-sm text-zinc-500 hover:underline">
          ← Targets
        </Link>
        <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight">
          {target.host}
        </h1>
        {target.label && (
          <p className="text-sm text-zinc-500">{target.label}</p>
        )}
        <p className="mt-1 text-xs text-zinc-500">
          scope {target.scope.hostPattern} — {target.scope.status}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => startScan("RECON")}
          disabled={!scopeApproved || starting !== null}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {starting === "RECON" ? "Starting…" : "Run recon"}
        </button>
        <button
          onClick={() => startScan("HUNT")}
          disabled={!scopeApproved || starting !== null}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {starting === "HUNT" ? "Starting…" : "Run hunt"}
        </button>
        <div className="ml-auto flex gap-4 text-sm">
          <Link
            href={`/targets/${id}/findings`}
            className="text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300"
          >
            Findings ({target.findings.length})
          </Link>
          <Link
            href={`/targets/${id}/report`}
            className="text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300"
          >
            Report
          </Link>
        </div>
      </div>

      {!scopeApproved && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          This target&apos;s scope is not approved, so scans are disabled.
        </p>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-medium">Scan runs</h2>
        {target.scanRuns.length === 0 ? (
          <p className="text-sm text-zinc-500">No scan runs yet.</p>
        ) : (
          <ul className="space-y-2">
            {target.scanRuns.map((run) => (
              <li
                key={run.id}
                className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              >
                <button
                  onClick={() =>
                    setOpenRun((cur) => (cur === run.id ? null : run.id))
                  }
                  className="flex w-full items-center justify-between gap-4 p-4 text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{run.type}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[run.status] ?? STATUS_STYLE.QUEUED
                      }`}
                    >
                      {run.status}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-400">
                    {openRun === run.id ? "Hide logs" : "View live logs"}
                  </span>
                </button>
                {openRun === run.id && (
                  <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
                    <ScanLogViewer scanRunId={run.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
