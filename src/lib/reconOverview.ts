/**
 * Presentation rules for a Target's latest Recon run.
 *
 * Kept out of the page component so the distinctions stay testable: a finished
 * job is not automatically a success, and a historical run without a recorded
 * outcome must never be displayed as successful.
 */

export type ReconTone = 'idle' | 'active' | 'success' | 'warning' | 'danger';

export type ReconRunLike =
  | {
      status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
      outcome: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'UNSUPPORTED' | null;
    }
  | null
  | undefined;

export type ReconOverview = {
  /** Short human label, always shown as text (never colour alone). */
  label: string;
  /** Semantic tone used for the badge surface. */
  tone: ReconTone;
  /** Optional clarification rendered next to the label. */
  detail: string | null;
};

const RESULT_UNKNOWN_DETAIL = 'Historical run without a recorded outcome.';

/**
 * Map a Recon run to its displayed state.
 *
 * `COMPLETED` only means the job ended. Its `outcome` decides whether the
 * execution actually succeeded, so `SUCCESS` is required before showing a
 * success state, and a null outcome stays explicitly unknown.
 */
export function reconOverview(run: ReconRunLike): ReconOverview {
  if (!run) return { label: 'Not run', tone: 'idle', detail: null };

  switch (run.status) {
    case 'QUEUED':
      return { label: 'Queued', tone: 'active', detail: 'Waiting for the worker to claim this run.' };
    case 'RUNNING':
      return { label: 'Running', tone: 'active', detail: null };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'idle', detail: 'Stopped on request; resources were cleaned up.' };
    case 'FAILED':
      return { label: 'Failed', tone: 'danger', detail: 'The run did not complete.' };
    default:
      break;
  }

  switch (run.outcome) {
    case 'SUCCESS':
      return { label: 'Completed', tone: 'success', detail: null };
    case 'PARTIAL':
      return {
        label: 'Partial',
        tone: 'warning',
        detail: 'Useful work completed, but errors, timeouts or limits reduced coverage.',
      };
    case 'FAILED':
      return { label: 'Failed', tone: 'danger', detail: 'The execution result is a failure.' };
    case 'UNSUPPORTED':
      return { label: 'Unsupported', tone: 'warning', detail: 'The requested technique has no engine.' };
    default:
      return { label: 'Result unknown', tone: 'idle', detail: RESULT_UNKNOWN_DETAIL };
  }
}

/** True when a Target has runnable Scope assets but no completed execution yet. */
export function needsFirstRecon(assetCount: number, run: ReconRunLike): boolean {
  return assetCount > 0 && !run;
}
