"use client";
import EvidencePanel from '@/components/EvidencePanel';
import { findingReviewStatus } from "@/lib/evidenceReview";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type Platform =
  | "HACKERONE"
  | "BUGCROWD"
  | "INTIGRITI"
  | "YESWEHACK"
  | "IMMUNEFI"
  | "GENERIC";

interface Finding {
  id: string;
  title: string;
  severity: string;
  gateStatus?: string;
  reviewStatus?: string;
}

const PLATFORMS: Platform[] = [
  "HACKERONE",
  "BUGCROWD",
  "INTIGRITI",
  "YESWEHACK",
  "IMMUNEFI",
  "GENERIC",
];

export default function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [reports, setReports] = useState<{ id: string; title: string; markdown: string }[]>([]);
  const [reportId, setReportId] = useState("");
  const [passed, setPassed] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<Platform>("HACKERONE");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [generating, setGenerating] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetch(`/api/findings?targetId=${encodeURIComponent(id)}`, { signal: controller.signal }), fetch(`/api/reports?targetId=${encodeURIComponent(id)}`, { signal: controller.signal })]).then(async ([findingsResponse, reportsResponse]) => {
      if (!findingsResponse.ok || !reportsResponse.ok) throw new Error("Unable to load findings and report history");
      const all: Finding[] = await findingsResponse.json(); setPassed(all.filter(f => findingReviewStatus(f) === "CONFIRMED"));
      const saved = await reportsResponse.json(); setReports(saved); setReportId(saved[0]?.id ?? ""); setMarkdown(saved[0]?.markdown ?? null);
    }).catch(e => { if (e.name !== "AbortError") setError("Unable to load findings and report history"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    const findingIds = passed.filter((f) => selected[f.id]).map((f) => f.id);
    if (findingIds.length === 0) {
      setError("Select at least one confirmed finding.");
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
      setReportId(report.id); setReports(previous => [report, ...previous]);
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
          href={`/hosts/${id}`}
          className="text-sm text-muted hover:text-foreground"
        >
          ← Host
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Report
        </h1>
        <p className="mt-1 text-sm text-muted">
          Only confirmed findings can be included.
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
        <form onSubmit={generate} className="grid gap-3">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Report title"
            placeholder="Report title"
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
          />
          <select
            aria-label="Report platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Confirmed findings</p>
            {loading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : passed.length === 0 ? (
              <p className="text-sm text-muted">
                No confirmed findings yet.
              </p>
            ) : (
              passed.map((f) => (
                <label
                  key={f.id}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={selected[f.id] === true}
                    onChange={(e) =>
                      setSelected((s) => ({ ...s, [f.id]: e.target.checked }))
                    }
                    className="accent-brand"
                  />
                  <span>{f.title}</span>
                  <Badge tone={f.severity.toLowerCase() as BadgeTone}>
                    {f.severity}
                  </Badge>
                </label>
              ))
            )}
          </div>

          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={generating || passed.length === 0}
            >
              {generating ? "Generating…" : "Generate report"}
            </Button>
          </div>
        </form>
      </Card>

      {reports.length > 0 && <label className="block text-sm">Saved report<select aria-label="Saved report" className="mt-2 block w-full rounded border border-border bg-surface p-2" value={reportId} onChange={e => { setReportId(e.target.value); setMarkdown(reports.find(r => r.id === e.target.value)?.markdown ?? null); }}>{reports.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>}
      {reportId&&<EvidencePanel key={reportId} targetId={id} reportId={reportId}/>}
      {markdown !== null && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">
            Generated markdown
          </h2>
          <Card className="overflow-x-auto bg-surface-3 p-4">
            <pre className="whitespace-pre-wrap font-mono text-sm text-foreground">
              {markdown}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
}
