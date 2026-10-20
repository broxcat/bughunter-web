"use client";

import {
  POLICY_SECTIONS,
  PROGRAM_PLATFORMS,
  type PolicyTextField,
  type ProgramPlatform,
} from "@/lib/scopePolicy";
import { Badge } from "@/components/ui/Badge";

export type PolicyValues = Partial<Record<PolicyTextField, string>> & {
  platform?: ProgramPlatform | "";
};

/** Subset of a Scope record that carries the policy (API values may be null). */
export type ScopePolicyData = {
  [K in PolicyTextField]?: string | null;
} & { platform?: ProgramPlatform | null };

const inputClass =
  "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle";

/** Fields to render in the create / edit form. All optional. */
export function ScopePolicyFields({
  values,
  onChange,
}: {
  values: PolicyValues;
  onChange: (next: PolicyValues) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label
          htmlFor="policy-platform"
          className="block text-xs font-medium text-foreground"
        >
          Platform
        </label>
        <select
          id="policy-platform"
          value={values.platform ?? ""}
          onChange={(e) =>
            onChange({
              ...values,
              platform: e.target.value as ProgramPlatform | "",
            })
          }
          className={inputClass}
        >
          <option value="">— not specified —</option>
          {PROGRAM_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {POLICY_SECTIONS.map((s) => {
        const id = `policy-${s.field}`;
        return (
          <div key={s.field} className="space-y-1">
            <label
              htmlFor={id}
              className="block text-xs font-medium text-foreground"
            >
              {s.label}
            </label>
            <textarea
              id={id}
              value={values[s.field] ?? ""}
              onChange={(e) => onChange({ ...values, [s.field]: e.target.value })}
              rows={s.emphasis ? 4 : 3}
              placeholder={s.hint}
              className={inputClass}
            />
          </div>
        );
      })}
    </div>
  );
}

/** True if the scope carries at least one filled policy field. */
export function hasPolicy(p: ScopePolicyData): boolean {
  return (
    Boolean(p.platform) ||
    POLICY_SECTIONS.some((s) => (p[s.field] ?? "").trim().length > 0)
  );
}

/**
 * Read-only view of the program policy. Out of Scope and Rules of Engagement are
 * surfaced first (when `emphasisFirst`) so they are the first thing seen before
 * running a technique that could touch something the program excludes.
 */
export function ScopePolicyView({
  policy,
  emphasisFirst = false,
}: {
  policy: ScopePolicyData;
  emphasisFirst?: boolean;
}) {
  const filled = POLICY_SECTIONS.filter(
    (s) => (policy[s.field] ?? "").trim().length > 0,
  );
  if (filled.length === 0 && !policy.platform) {
    return <p className="text-sm text-muted">No program policy recorded.</p>;
  }

  const ordered = emphasisFirst
    ? [...filled].sort((a, b) => Number(!!b.emphasis) - Number(!!a.emphasis))
    : filled;

  return (
    <div className="space-y-3">
      {policy.platform && (
        <p className="flex items-center gap-2 text-xs text-muted">
          Platform <Badge tone="brand">{policy.platform}</Badge>
        </p>
      )}
      {ordered.map((s) => (
        <div key={s.field}>
          <h4 className="flex items-center gap-2 text-xs font-medium text-foreground">
            {s.label}
            {s.emphasis && <Badge tone="high">check before testing</Badge>}
          </h4>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
            {policy[s.field]}
          </p>
        </div>
      ))}
    </div>
  );
}
