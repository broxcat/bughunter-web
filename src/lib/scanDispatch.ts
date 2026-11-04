// Delivery and execution identity are additive; historical attempts stay unknown.
export function withScanDispatch<T extends { jobOutbox?: { status: string } | null; executionAttempts?: { id: string; state: string; reason: string | null }[]; authenticatedContextsSnapshot?: unknown; authenticatedReconResult?: unknown }>(run: T) {
  // Verification identity, private seed fingerprints and credential references
  // are server-only. Context UI uses the dedicated redacted factual projection.
  const { jobOutbox, executionAttempts, authenticatedContextsSnapshot, authenticatedReconResult, ...scan } = run;
  void authenticatedContextsSnapshot; void authenticatedReconResult;
  return { ...scan, dispatch: jobOutbox?.status ?? null, execution: executionAttempts?.[0] ?? null };
}
