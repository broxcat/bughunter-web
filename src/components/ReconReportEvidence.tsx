import type { ReconReportModel } from '@/lib/reconReportModel';
export function EvidenceRefs({refs}:{refs:string[]}) {
  return refs.length ? <details className="mt-1 text-xs text-muted"><summary>Evidence references</summary><p className="break-all">{refs.join(', ')}</p></details> : <p className="text-xs text-muted">Evidence identity not recorded.</p>;
}
export default function ReconReportEvidence({model}:{model:ReconReportModel}) {
  return <>
    <section aria-label="DNS and hosts" className="space-y-2">
      <h3 className="font-semibold">DNS and hosts</h3>
      {!model.dnsRecords.some(r=>r.value!==null)&&<p>{model.evidenceTruncated?'DNS evidence not included in the bounded report inventory; consult retained artifacts.':'DNS evidence not recorded for this run.'}</p>}
      <ul className="space-y-2 text-sm">{model.dnsRecords.slice(0,100).map(row=><li key={`${row.refs.join(":")}:${row.host}:${row.recordType}:${row.value}`} className="break-all"><span className="font-mono">{row.host}{row.value?` → ${row.value}`:''}</span> · {row.recordType??'Record type not recorded'}<p className="text-xs text-muted">{row.relationship}</p><EvidenceRefs refs={row.refs}/></li>)}</ul>
      {model.dnsRecords.length>100&&<p>First 100 DNS/host observations shown; Markdown retains the full report inventory.</p>}
      <p className="text-xs text-muted">Observed names and DNS destinations never grant authorization. Missing evidence is not NXDOMAIN.</p>
    </section>
    <section aria-label="TLS evidence" className="space-y-2">
      <h3 className="font-semibold">TLS evidence</h3>
      {model.tls.length?<ul className="space-y-3 text-sm">{model.tls.slice(0,50).map((row,i)=><li key={row.refs[0]??`${row.host}:${i}`} className="break-all"><p className="font-medium">TLS observation · {row.host}</p>{row.properties.length?<dl>{row.properties.map(p=><div key={p.name}><dt className="inline text-muted">{p.name}: </dt><dd className="inline">{p.value}</dd></div>)}</dl>:<p>Certificate properties not recorded.</p>}<EvidenceRefs refs={row.refs}/></li>)}</ul>:<p>{model.evidenceTruncated?'TLS evidence not included in the bounded report inventory; consult retained artifacts.':'TLS evidence not recorded for this run.'}</p>}
      {model.tls.length>50&&<p>First 50 TLS observations shown; Markdown retains the full report inventory.</p>}
      <p className="text-xs text-muted">Unlisted certificate properties, SANs, validation, negotiated protocol and cipher were not recorded. HTTPS URLs alone do not prove TLS details or open ports.</p>
    </section>
    <section aria-label="Redirect observations" className="space-y-2">
      <h3 className="font-semibold">Redirect observations</h3>
      {model.redirects.length?<ul className="space-y-2 text-sm">{model.redirects.slice(0,50).map((r,i)=><li key={r.refs[0]??`${r.from}:${r.to}:${i}`} className="break-all">{r.from??'Origin not recorded'} → {r.to}<EvidenceRefs refs={r.refs}/></li>)}</ul>:<p>No redirect observation recorded.</p>}
      {model.redirects.length>50&&<p>First 50 redirects shown; Markdown retains the full report inventory.</p>}
      <p className="text-xs text-muted">A recorded redirect does not establish that its destination was requested.</p>
    </section>
    <section aria-label="Static assets" className="space-y-2">
      <h3 className="font-semibold">Static assets</h3>
      {model.staticAssets.length?<ul className="space-y-3 text-sm">{model.staticAssets.map(group=><li key={group.category}><p className="font-medium">{group.category} · {group.count} resources in report inventory</p><ul>{group.samples.map(sample=><li key={sample.url} className="break-all font-mono text-xs">{sample.url}<EvidenceRefs refs={sample.refs}/></li>)}</ul>{group.truncated&&<p className="text-xs text-muted">First 5 representative resources shown.</p>}</li>)}</ul>:<p>Static asset evidence not recorded in the report inventory.</p>}
      <p className="text-xs text-muted">{model.evidenceTruncated?'Report evidence is truncated; these counts are a lower bound.':'Counts cover the retained report inventory.'} Static resources are not vulnerabilities or proof of secrets.</p>
    </section>

  </>;
}

export function ReportProvenance({model}:{model:ReconReportModel}) {
  return <section aria-label="Evidence provenance" className="space-y-2">
      <h3 className="font-semibold">Evidence provenance</h3>
      <p className="text-xs text-muted">Fact references resolve to retained artifacts and captured execution context. No Evidence Vault reference is invented.</p>
      <details><summary>Sources and execution context ({model.provenance.length} retained records)</summary><ul className="mt-2 space-y-3 text-xs">{model.provenance.slice(0,100).map((row,i)=><li key={`${row.entity}:${row.id??i}`} className="break-all"><p>{row.fact}</p><p>{row.entity}: {row.id??'Not recorded'} · ScanRun: {row.scanRunId??'Not recorded'} · TargetReconRun: {row.runId}</p><p>Context: {row.host} · {row.verification} · {row.scopeState}</p><p>Source: {row.sources.join('; ')||'Not recorded'}</p><p>First observed: {row.firstSeenAt??'Not recorded'} · Last observed: {row.lastSeenAt??'Not recorded'}</p></li>)}</ul>{model.provenance.length>100&&<p>First 100 references displayed. Markdown includes all retained report references; full artifacts remain in Scope evidence.</p>}</details>
    </section>;
}
