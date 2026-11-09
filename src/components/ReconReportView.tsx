import ReconRunNarrative from './ReconRunNarrative';
import type {RunNarrative} from '@/lib/reconRunNarrative';
import ReconReportEvidence,{ReportProvenance} from './ReconReportEvidence';
import type { ReconReportModel } from '@/lib/reconReportModel';

/**
 * Deterministic Recon report. Server component with no client state: the
 * Markdown export and this view are rendered from the same model.
 */
export default function ReconReportView({ model,narrative }: { model: ReconReportModel;narrative?:RunNarrative }) {
  const { metadata, authorization, methodology, web, authenticated, changes } = model;

  return <section aria-labelledby="recon-report-heading" className="recon-report space-y-6">
    <div className="space-y-1">
      <h2 id="recon-report-heading" className="text-xl font-semibold">Report</h2>
      <p className="text-sm text-muted">Generated from stored Recon evidence.</p>
    </div>

    <section aria-label="Executive summary" className="space-y-2">
      <h3 className="font-semibold">Executive summary</h3>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-subtle">Execution result</dt><dd>{metadata.outcomeLabel}</dd></div>
        <div><dt className="text-subtle">Job status</dt><dd>{metadata.status}</dd></div>
        <div><dt className="text-subtle">Recon date</dt><dd>{metadata.reconDate}</dd></div>
        <div><dt className="text-subtle">Duration</dt><dd>{metadata.duration ?? 'Not recorded'}</dd></div>
        <div><dt className="text-subtle">Asset executions recorded</dt><dd>{metadata.hosts}</dd></div>
        <div><dt className="text-subtle">Assessment mode</dt><dd>{metadata.assessmentMode}</dd></div>
        <div><dt className="text-subtle">Observations</dt><dd>{model.observationsTotal}</dd></div>
        <div><dt className="text-subtle">Stages</dt><dd>{metadata.stageCounts.completed} completed · {metadata.stageCounts.partial} partial · {metadata.stageCounts.failed} failed · {metadata.stageCounts.skipped} skipped</dd></div>
      </dl>
      {model.limitations.length > 0 && <div className="text-sm">
        <p className="text-subtle">Major limitations</p>
        <ul className="mt-1 space-y-0.5">
          {model.limitations.slice(0, 5).map(item => <li key={`${item.host}:${item.stage}`}>{item.host} · {item.stage}: {item.label}{item.reason ? ` — ${item.reason}` : ''}</li>)}
        </ul>
      </div>}
    </section>



    <section aria-label="Scope and authorization" className="space-y-2">
      <h3 className="font-semibold">Scope and authorization</h3>
      <p className="text-sm text-muted">{authorization.note}</p>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="text-subtle">Authorized assets</dt><dd className="break-all">{authorization.authorized.join(', ') || 'None recorded'}</dd></div>
        <div><dt className="text-subtle">Observed hosts (not authorization)</dt><dd className="break-all">{authorization.observed.join(', ') || 'None recorded'}</dd></div>
        <div><dt className="text-subtle">Captured exclusions</dt><dd className="break-all">{authorization.excluded.join(', ') || (authorization.exclusionsRecorded?'None (captured policy)':'Not recorded')}</dd></div>
        <div><dt className="text-subtle">Required User-Agent</dt><dd className="break-all font-mono text-xs">{authorization.userAgent ?? 'Not recorded'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-subtle">Engagement rules</dt><dd className="whitespace-pre-wrap">{authorization.rules ?? 'Not recorded'}</dd></div>
      </dl>
    </section>

    <section aria-label="Important observations" className="space-y-2"><h3 className="font-semibold">Important observations</h3><ul className="space-y-1 text-sm"><li>{web.responsiveHosts.length} responsive hosts · {web.endpoints.length} web endpoints · {model.network.length} port/service observations</li>{web.authSurfaces.length>0&&<li>Authentication surfaces: {web.authSurfaces.join(', ')}</li>}{web.apiSurfaces.length>0&&<li>API surfaces: {web.apiSurfaces.join(', ')}</li>}</ul></section>
    <section aria-label="Ports and services" className="space-y-2">
      <h3 className="font-semibold">Ports and services</h3>
      {model.network.length
        ? <div className="ui-table-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Observed network: Host, port and protocol"><table className="w-full min-w-[520px] text-left text-sm">
            <thead><tr className="border-b border-border">{['Host', 'Port', 'Protocol', 'Service', 'Evidence'].map(heading => <th key={heading} scope="col" className="p-2">{heading}</th>)}</tr></thead>
            <tbody>{model.network.map(row => <tr key={`${row.host}:${row.port}:${row.protocol??"unrecorded"}`} className="border-b border-border"><td className="break-all p-2 font-mono text-xs">{row.host}</td><td className="p-2">{row.port}</td><td className="p-2">{row.protocol ?? '—'}</td><td className="p-2">{(row.service ?? 'Not recorded') + ' · ' + (row.state??'state not recorded')}</td><td className="p-2 text-muted">{row.source}</td></tr>)}</tbody>
          </table></div>
        : <p className="text-sm text-muted">{model.evidenceTruncated ? 'No port/service observation included in the bounded report inventory; consult retained artifacts.' : model.portDiscoveryPerformed ? 'Port discovery ran but recorded no open service observation.' : 'No port discovery execution was recorded; network coverage remains unknown.'}</p>}
    </section>

    <section aria-label="Web surface" className="space-y-2">
      <h3 className="font-semibold">Web surface</h3>
      <dl className="grid gap-x-6 gap-y-1 text-sm">
        <div><dt className="text-subtle">Responsive hosts</dt><dd className="break-all">{web.responsiveHosts.join(', ') || 'None recorded'}</dd></div>
        <div><dt className="text-subtle">HTTP status codes</dt><dd>{web.statusCodes.join(', ') || 'None recorded'}</dd></div>
        <div><dt className="text-subtle">Authentication signals (unverified)</dt><dd className="break-all">{web.authSurfaces.join(', ') || 'None recorded'}</dd></div>
        <div><dt className="text-subtle">API signals (unverified)</dt><dd className="break-all">{web.apiSurfaces.join(', ') || 'None recorded'}</dd></div>
        <div><dt className="text-subtle">Technologies</dt><dd>{web.technologies.length ? web.technologies.map(tech => `${tech.name}${tech.version ? ` ${tech.version}` : ' (version unconfirmed)'}`).join(', ') : 'None recorded'}</dd></div>
      </dl>
      {web.endpoints.length > 0 && <>
        <ul className="space-y-0.5 text-sm">{web.endpoints.slice(0, 50).map(endpoint => <li key={endpoint.url} className="break-all font-mono text-xs">{endpoint.method ?? 'Method not recorded'} {endpoint.url}{endpoint.status ? ` · ${endpoint.status}` : ''}</li>)}</ul>
        {web.endpoints.length > 50 && <p className="text-xs text-muted">First 50 of {web.endpoints.length} endpoints shown; the full inventory remains in the artifacts.</p>}
      </>}
      <p className="text-xs text-muted">Observed endpoints are evidence, not confirmed vulnerabilities.</p>
    </section>

    <section aria-label="Errors and limitations" className="space-y-2">
      <h3 className="font-semibold">Errors and limitations</h3>
      {model.limitations.length
        ? <ul className="space-y-1 text-sm">{model.limitations.map(item => <li key={`${item.host}:${item.stage}`}><span className="font-medium">{item.host} · {item.stage}</span> · {item.label}{item.reason ? ` — ${item.reason}` : ''}</li>)}</ul>
        : <p className="text-sm text-muted">No stage reported a failure, partial result, skip or cancellation.</p>}
      <p className="text-xs text-muted">Unrecorded coverage is unknown; it is never reported as safe.</p>
    </section>

    <section aria-label="Changes since previous Recon" className="space-y-2">
      <h3 className="font-semibold">Changes since previous Recon</h3>
      {changes
        ? <><p className="text-sm">{changes.new} new · {changes.changed} changed · {changes.notObserved} not observed · {changes.unchanged} unchanged</p><p className="text-sm text-muted">{changes.note}</p></>
        : <p className="text-sm text-muted">No comparison data was recorded for this run.</p>}
    </section>



    <section aria-label="Research handoff" className="space-y-2">
      <h3 className="font-semibold">Research handoff</h3>
      <ul className="space-y-1 text-sm">{model.researchHandoff.map(item => <li key={item}>{item}</li>)}</ul>
      <p className="text-xs text-muted">Priorities come from recorded evidence only. No Finding is created automatically.</p>
    </section>
    <details className="ui-disclosure"><summary>Technical details</summary><div className="mt-5 space-y-6">    <section aria-label="Methodology" className="space-y-2">
      <h3 className="font-semibold">Methodology</h3>
      {methodology.stages.length
        ? <div className="ui-table-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Recon methodology: Stage and planned tools"><table className="w-full min-w-[420px] text-left text-sm">
            <thead><tr className="border-b border-border"><th scope="col" className="p-2">Stage</th><th scope="col" className="p-2">Planned tools</th></tr></thead>
            <tbody>{methodology.stages.map(stage => <tr key={stage.name} className="border-b border-border"><td className="p-2">{stage.name}</td><td className="p-2 font-mono text-xs">{stage.tools.join(', ') || 'None recorded'}</td></tr>)}</tbody>
          </table></div>
        : <p className="text-sm text-muted">No stage detail was recorded for this run.</p>}
      <p className="text-sm text-muted">Authenticated contexts: {methodology.authenticated ? 'recorded' : 'none recorded'} · {methodology.activity === 'UNKNOWN' ? 'Activity not recorded' : methodology.activity.toLowerCase() + ' (captured plan)'}</p>
    </section>

    <section aria-label="Execution overview" className="space-y-2">
      <h3 className="font-semibold">Execution overview</h3>
      {model.execution.length
        ? <div className="ui-table-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Recon execution: Host, phase and recorded tool"><table className="w-full min-w-[640px] text-left text-sm">
            <thead><tr className="border-b border-border">{['Host', 'Phase', 'Tool', 'Result', 'Notes'].map(heading => <th key={heading} scope="col" className="p-2">{heading}</th>)}</tr></thead>
            <tbody>{model.execution.map((line, index) => <tr key={`${line.host}:${line.name}:${index}`} className="border-b border-border align-top">
              <td className="break-all p-2 font-mono text-xs">{line.host}</td>
              <td className="p-2">{line.name}</td>
              <td className="p-2 font-mono text-xs">{line.tools.join(', ') || 'Not recorded'}</td>
              <td className="p-2">{line.label}</td>
              <td className="p-2 text-muted">{line.reason ?? '—'}</td>
            </tr>)}</tbody>
          </table></div>
        : <p className="text-sm text-muted">No stage detail was recorded for this run.</p>}
    </section>

    <section aria-label="Tools and commands" className="space-y-2">
      <h3 className="font-semibold">Tools and commands</h3>
      {model.tools.length
        ? <><div className="ui-table-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Recorded tools: Version and invocation"><table className="w-full min-w-[480px] text-left text-sm">
            <thead><tr className="border-b border-border">{['Tool', 'Version', 'Invocation'].map(heading => <th key={heading} scope="col" className="p-2">{heading}</th>)}</tr></thead>
            <tbody>{model.tools.map(tool => <tr key={tool.name} className="border-b border-border"><td className="p-2 font-mono text-xs">{tool.name}</td><td className="p-2">{tool.version ?? 'Not recorded'}</td><td className="p-2 text-muted">{tool.invocation ?? 'Invocation not recorded'}</td></tr>)}</tbody>
          </table></div>
          <p className="text-xs text-muted">Commands appear only when the execution stored them; a tool name is never expanded into a command.</p></>
        : <p className="text-sm text-muted">No tool was recorded for this run.</p>}
    </section>



    <section aria-label="Authenticated Recon" className="space-y-2">
      <h3 className="font-semibold">Authenticated Recon</h3>
      <p className="text-sm text-muted">{authenticated.note}</p>
      {authenticated.contexts.length > 0 && <ul className="space-y-1 text-sm">{authenticated.contexts.map((context, index) => <li key={`${context.label}:${index}`}>{context.label} · {context.state} · {context.observations} usable observations</li>)}</ul>}
    </section>

<ReconReportEvidence model={model}/><ReportProvenance model={model}/></div></details>
    <details className="ui-disclosure"><summary>Optional AI synthesis</summary><div className="mt-4"><ReconRunNarrative narrative={narrative??{state:'DETERMINISTIC',highlights:[]}}/></div></details>
  </section>;
}
