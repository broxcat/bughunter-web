"use client";

import { useState } from "react";
import {
  CvssCalculator,
  metricsFromVector,
  vectorOf,
} from "@/components/CvssCalculator";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cweUrl } from "@/lib/cwe";

export interface ClassifiedFinding {
  id: string;
  cwe: string | null;
  cvssVector: string | null;
  cvssScore: number | null;
  impact: string | null;
  remediation: string | null;
}

const inputClass =
  "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle";

/** CWE + CVSS summary chips shown beside the severity badge (display only). */
export function ClassificationChips({ f }: { f: ClassifiedFinding }) {
  const url = cweUrl(f.cwe);
  return (
    <>
      {f.cwe &&
        (url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brand hover:text-brand-hover"
          >
            {f.cwe}
          </a>
        ) : (
          <span className="font-mono text-xs text-subtle">{f.cwe}</span>
        ))}
      {f.cvssScore !== null && f.cvssScore !== undefined && (
        <span className="text-xs text-muted" title={f.cvssVector ?? undefined}>
          CVSS {f.cvssScore.toFixed(1)}
        </span>
      )}
    </>
  );
}

/**
 * Edit CWE, the CVSS v3.1 vector, and the manual Impact / Remediation report
 * sections. Saved through PATCH /api/findings/[id]; severity and the gate are
 * not touched.
 */
export function FindingClassification({
  finding,
  onSaved,
}: {
  finding: ClassifiedFinding;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [cwe, setCwe] = useState(finding.cwe ?? "");
  const [metrics, setMetrics] = useState(() => metricsFromVector(finding.cvssVector));
  const [impact, setImpact] = useState(finding.impact ?? "");
  const [remediation, setRemediation] = useState(finding.remediation ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partial = Object.keys(metrics).length > 0 && vectorOf(metrics) === null;

  async function save() {
    if (partial) {
      setError("Finish the CVSS metrics or clear them before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${finding.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwe: cwe.trim() ? cwe.trim().toUpperCase() : null,
          cvssVector: vectorOf(metrics),
          impact: impact.trim() || null,
          remediation: remediation.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const detail = j.details?.fieldErrors
          ? Object.values(j.details.fieldErrors).flat().join("; ")
          : "";
        throw new Error(detail || j.error || `Save failed (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-muted hover:text-foreground"
      >
        {open ? "Hide" : "Edit"} classification &amp; report details (CWE, CVSS
        3.1, impact, remediation)
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <div className="space-y-1">
            <label
              htmlFor={`cwe-${finding.id}`}
              className="block text-xs font-medium text-foreground"
            >
              CWE
            </label>
            <input
              id={`cwe-${finding.id}`}
              value={cwe}
              onChange={(e) => setCwe(e.target.value)}
              placeholder="CWE-79"
              className={`${inputClass} font-mono`}
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">
              CVSS 3.1 base score{" "}
              <span className="font-normal text-subtle">
                (shown beside the severity badge; does not change it)
              </span>
            </p>
            <CvssCalculator value={metrics} onChange={setMetrics} />
          </div>

          <div className="space-y-1">
            <label
              htmlFor={`impact-${finding.id}`}
              className="block text-xs font-medium text-foreground"
            >
              Impact
            </label>
            <textarea
              id={`impact-${finding.id}`}
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              rows={3}
              placeholder="Business / technical impact you demonstrated"
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor={`remediation-${finding.id}`}
              className="block text-xs font-medium text-foreground"
            >
              Remediation
            </label>
            <textarea
              id={`remediation-${finding.id}`}
              value={remediation}
              onChange={(e) => setRemediation(e.target.value)}
              rows={3}
              placeholder="Suggested fix"
              className={inputClass}
            />
          </div>

          {error && (
            <p className="flex items-center gap-2 text-xs">
              <Badge tone="critical">Error</Badge>
              <span className="text-foreground">{error}</span>
            </p>
          )}
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save details"}
          </Button>
        </div>
      )}
    </div>
  );
}
