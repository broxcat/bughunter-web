// Preserve all existing ScanRun properties; expose delivery separately from the
// execution outcome. Historical scans have dispatch=null, never an invented job.
export function withScanDispatch<T extends { jobOutbox?: { status: string } | null }>(run: T) {
  const { jobOutbox, ...scan } = run;
  return { ...scan, dispatch: jobOutbox?.status ?? null };
}
