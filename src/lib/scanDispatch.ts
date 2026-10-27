// Delivery and execution identity are additive; historical attempts stay unknown.
export function withScanDispatch<T extends { jobOutbox?: { status: string } | null; executionAttempts?: { id: string; state: string; reason: string | null }[] }>(run: T) {
  const { jobOutbox, executionAttempts, ...scan } = run;
  return { ...scan, dispatch: jobOutbox?.status ?? null, execution: executionAttempts?.[0] ?? null };
}
