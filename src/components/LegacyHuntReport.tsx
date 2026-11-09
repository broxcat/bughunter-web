export default function LegacyHuntReport({ report, snapshot }: { report: unknown; snapshot?: unknown }) {
  return <section className="space-y-4"><h2 className="text-xl">Legacy hunt report</h2>
    <p>This scan was produced by the retired vulnerability-family Hunt engine.</p>
    <p>Historical read-only record. Findings and reports retain their original identities and evidence review.</p>
    {report ? <pre className="overflow-auto whitespace-pre-wrap rounded border border-border p-4">{JSON.stringify(report, null, 2)}</pre> : <p>No technique report was recorded for this historical run.</p>}
    {snapshot != null && <details><summary>Historical execution policy</summary><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(snapshot, null, 2)}</pre></details>}
  </section>;
}
