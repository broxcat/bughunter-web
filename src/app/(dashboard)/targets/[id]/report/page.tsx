"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

type Platform = "HACKERONE" | "BUGCROWD" | "INTIGRITI" | "IMMUNEFI" | "GENERIC";

interface Finding {
  id: string;
  title: string;
  severity: string;
  gateStatus: string;
}

const PLATFORMS: Platform[] = [
  "HACKERONE",
  "BUGCROWD",
  "INTIGRITI",
  "IMMUNEFI",
  "GENERIC",
];

export default function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [passed, setPassed] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<Platform>("HACKERONE");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [generating, setGenerating] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/findings?targetId=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Failed to load findings (${res.status})`);
      const all: Finding[] = await res.json();
      setPassed(all.filter((f) => f.gateStatus === "PASSED"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load findings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    const findingIds = passed.filter((f) => selected[f.id]).map((f) => f.id);
    if (findingIds.length === 0) {
      setError("Select at least one passed finding.");
      return;
    }
    setGenerating(true);
    setError(null);
    setMarkdown(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, platform, findingIds }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to generate report (${res.status})`);
      }
      const report = await res.json();
      setMarkdown(report.markdown ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/targets/${id}`}
          className="text-sm text-zinc-500 hover:underline"
        >
          ← Target
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Report</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Only findings that passed the gate can be included.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}

      <form
        onSubmit={generate}
        className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Report title"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <div className="space-y-1">
          <p className="text-sm font-medium">Passed findings</p>
          {loading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : passed.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No findings have passed the gate yet.
            </p>
          ) : (
            passed.map((f) => (
              <label key={f.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected[f.id] === true}
                  onChange={(e) =>
                    setSelected((s) => ({ ...s, [f.id]: e.target.checked }))
                  }
                />
                <span>{f.title}</span>
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                  {f.severity}
                </span>
              </label>
            ))
          )}
        </div>

        <div>
          <button
            type="submit"
            disabled={generating || passed.length === 0}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {generating ? "Generating…" : "Generate report"}
          </button>
        </div>
      </form>

      {markdown !== null && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Generated markdown</h2>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            {markdown}
          </pre>
        </div>
      )}
    </div>
  );
}
