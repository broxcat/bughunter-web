"use client";

import { useId } from "react";
import {
  CVSS_METRICS,
  buildVector,
  calculateBaseScore,
  cvssRating,
  parseVector,
  type CvssMetrics,
  type MetricKey,
  type CvssRating,
} from "@/lib/cvss";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

type Partial8 = Partial<Record<MetricKey, string>>;

// CVSS ratings reuse the existing severity badge scale; this is display only and
// never replaces Finding.severity.
const RATING_TONE: Record<CvssRating, BadgeTone> = {
  None: "info",
  Low: "low",
  Medium: "medium",
  High: "high",
  Critical: "critical",
};

/** Metrics from a stored vector, or an empty selection if absent/invalid. */
export function metricsFromVector(vector?: string | null): Partial8 {
  return (vector && parseVector(vector)) || {};
}

/** The vector for a selection, or null until all eight metrics are chosen. */
export function vectorOf(sel: Partial8): string | null {
  const complete = CVSS_METRICS.every((d) => sel[d.key]);
  return complete ? buildVector(sel as CvssMetrics) : null;
}

/**
 * CVSS v3.1 Base Score calculator (controlled). The score shown here is for
 * live feedback; the server recomputes it from the vector when saving.
 */
export function CvssCalculator({
  value,
  onChange,
}: {
  value: Partial8;
  onChange: (next: Partial8) => void;
}) {
  const uid = useId();
  const vector = vectorOf(value);
  const score = vector ? calculateBaseScore(value as CvssMetrics) : null;
  const rating = score !== null ? cvssRating(score) : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {CVSS_METRICS.map((def) => (
          <fieldset key={def.key} className="space-y-1">
            <legend className="text-xs font-medium text-foreground">
              {def.name} <span className="text-subtle">({def.key})</span>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {def.options.map((o) => {
                const selected = value[def.key] === o.value;
                return (
                  <label
                    key={o.value}
                    className={[
                      "cursor-pointer rounded-md border px-2 py-1 text-xs",
                      selected
                        ? "border-brand bg-surface-2 text-foreground"
                        : "border-border text-muted hover:text-foreground",
                    ].join(" ")}
                  >
                    <input
                      type="radio"
                      name={`${uid}-${def.key}`}
                      className="sr-only"
                      checked={selected}
                      onChange={() => onChange({ ...value, [def.key]: o.value })}
                    />
                    {o.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
        {score !== null && rating ? (
          <>
            <span className="text-lg font-semibold text-foreground">
              {score.toFixed(1)}
            </span>
            <Badge tone={RATING_TONE[rating]}>{rating}</Badge>
            <code className="break-all font-mono text-xs text-muted">{vector}</code>
          </>
        ) : (
          <span className="text-xs text-subtle">
            Select all eight base metrics to compute the score.
          </span>
        )}
        {Object.keys(value).length > 0 && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="ml-auto text-xs text-muted hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
