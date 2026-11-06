/**
 * Presentation rules for a Recon execution timeline.
 *
 * The backend stores pipeline steps with a coarse state machine; this module
 * turns those states into stable, text-labelled views so status is never
 * communicated by colour alone and never overstates what actually ran.
 */

import { redactObservationText } from '@/lib/observationSafety';

export type StepTone = 'idle' | 'active' | 'success' | 'warning' | 'danger';

export type StepView = {
  label: string;
  /** Text glyph paired with the label; never the only signal. */
  symbol: string;
  tone: StepTone;
  /** True when the state reduced coverage or explains missing evidence. */
  limitation: boolean;
};

const VIEWS: Record<string, StepView> = {
  PENDING: { label: 'Pending', symbol: '·', tone: 'idle', limitation: false },
  RUNNING: { label: 'Running', symbol: '●', tone: 'active', limitation: false },
  COMPLETED: { label: 'Completed', symbol: '✓', tone: 'success', limitation: false },
  COMPLETED_WITH_FALLBACK: { label: 'Completed (fallback)', symbol: '✓', tone: 'success', limitation: false },
  PARTIAL: { label: 'Partial', symbol: '!', tone: 'warning', limitation: true },
  BLOCKED: { label: 'Blocked', symbol: '■', tone: 'warning', limitation: true },
  FAILED: { label: 'Failed', symbol: '×', tone: 'danger', limitation: true },
  SKIPPED: { label: 'Skipped', symbol: '–', tone: 'idle', limitation: true },
  SKIPPED_UNSUPPORTED: { label: 'Unsupported', symbol: '–', tone: 'idle', limitation: true },
  SKIPPED_NOT_APPLICABLE: { label: 'Not applicable', symbol: '–', tone: 'idle', limitation: true },
  CANCELLED: { label: 'Cancelled', symbol: '–', tone: 'idle', limitation: true },
};

const UNKNOWN: StepView = { label: 'Unknown', symbol: '?', tone: 'idle', limitation: false };

/** Map a persisted pipeline state; unknown values stay explicit rather than guessed. */
export function stepView(state: string | null | undefined): StepView {
  return (state && VIEWS[state]) || UNKNOWN;
}

export type StagePlan = { stages?: Array<{ name: string; tools?: string[] }> } | null | undefined;

/**
 * Tools recorded in the immutable execution plan for this stage.
 * Returns an empty list when the plan predates stage tool capture, so callers
 * never reconstruct a command from a stage name alone.
 */
export function stageTools(stageName: string, plan: StagePlan): string[] {
  const tools = plan?.stages?.find(stage => stage.name === stageName)?.tools;
  return Array.isArray(tools) ? tools.filter((tool): tool is string => typeof tool === 'string' && tool.length > 0) : [];
}

/** Human duration from milliseconds; null when the value is not a usable number. */
export function formatDuration(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes} min ${rest} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Wall-clock duration between two captured timestamps, or null when incomplete. */
export function elapsed(start: Date | string | null | undefined, end: Date | string | null | undefined): string | null {
  if (!start || !end) return null;
  const from = start instanceof Date ? start.getTime() : Date.parse(start);
  const to = end instanceof Date ? end.getTime() : Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return formatDuration(to - from);
}

/** Per-capability detail rows recorded by the coverage tracker, defensively read. */
export type CapabilityRow = { capability: string; state: string | null };

export function capabilityRows(details: unknown): CapabilityRow[] {
  const capabilities = (details as { capabilities?: unknown } | null)?.capabilities;
  if (!Array.isArray(capabilities)) return [];
  return capabilities.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const { capability, state } = item as { capability?: unknown; state?: unknown };
    return typeof capability === 'string' && capability.length > 0
      ? [{ capability, state: typeof state === 'string' ? state : null }]
      : [];
  });
}

/** Coarse grouping used by the discoveries section; unknown kinds stay verbatim. */
const KIND_GROUPS: Array<{ label: string; kinds: string[] }> = [
  { label: 'Hosts', kinds: ['host', 'subdomain', 'domain'] },
  { label: 'URLs and endpoints', kinds: ['endpoint', 'url'] },
  { label: 'Ports and services', kinds: ['port', 'service'] },
  { label: 'Technologies', kinds: ['technology'] },
  { label: 'Authentication surfaces', kinds: ['auth-surface'] },
  { label: 'API surfaces', kinds: ['api-surface'] },
];

export type KindCount = { kind: string; count: number };

/**
 * Group observed artifact kinds for display. Only kinds actually recorded are
 * returned; nothing is inferred from the stage list.
 */
export function groupObservationKinds(counts: KindCount[]): Array<{ label: string; count: number; kinds: KindCount[] }> {
  const remaining = new Map(counts.map(count => [count.kind, count.count]));
  const groups = KIND_GROUPS.map(group => {
    const matched: KindCount[] = [];
    for (const kind of group.kinds) {
      const count = remaining.get(kind);
      if (count) {
        matched.push({ kind, count });
        remaining.delete(kind);
      }
    }
    return { label: group.label, count: matched.reduce((sum, item) => sum + item.count, 0), kinds: matched };
  }).filter(group => group.count > 0);
  const others = [...remaining.entries()].map(([kind, count]) => ({ kind, count }));
  if (others.length) groups.push({ label: 'Other observations', count: others.reduce((sum, item) => sum + item.count, 0), kinds: others });
  return groups;
}

/**
 * Redact raw Recon output before it reaches the DOM.
 * Reuses the existing observation scrubber so secrets policy stays in one place.
 */
export function redactLogLines(lines: Array<{ line: string; stream: 'STDOUT' | 'STDERR' }>): Array<{ text: string; stream: 'STDOUT' | 'STDERR' }> {
  return lines.map(({ line, stream }) => ({ text: redactObservationText(line), stream }));
}
