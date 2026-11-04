import type { ReconReportV3 } from '@/lib/reconReportV3';
import { presentReconFacts, reconSynthesisPresentation } from '@/lib/reconFactPresentation';

const coverageLabels = {
  completed: 'Completed', fallback: 'Completed with a fallback', partial: 'Partial',
  blocked: 'Blocked', notApplicable: 'Not applicable', notTested: 'Not tested', failed: 'Failed',
};
const human = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/, letter => letter.toUpperCase());
const formatLabel = (value: string) => ['URL', 'IP', 'CIDR'].includes(value) ? value : human(value);
const typeLabel = (value: string) => value === 'API' ? 'API' : value === 'WEB_APPLICATION' ? 'Web Application' : human(value);
const observationLabel = (value: string) => value === value.toLowerCase() ? human(value.replaceAll('-', ' ')) : value;
function Evidence({ refs }: { refs: string[] }) {
  return refs.length ? <details className="mt-1 text-xs text-muted"><summary>Evidence references</summary><p className="break-all">{refs.join(', ')}</p></details> : null;
}
function NarrativeEntries({ title, entries }: { title: string; entries: ReconReportV3['narrative']['webSurface'] }) {
  return entries.length ? <section className="space-y-2"><h4 className="font-medium">{title}</h4><ul className="space-y-3">{entries.map((entry, index) => <li key={index}>
    <p className="whitespace-pre-wrap break-words">{entry.text}</p>
    <p className="text-xs text-muted">{entry.confidence === 'observed' ? 'Evidence-based interpretation' : 'Hypothesis — manual validation required'}</p>
    <Evidence refs={entry.evidenceRefs} />
  </li>)}</ul></section> : null;
}

/** Recon evidence is application-owned; model prose never replaces this record. */
export default function ReconReportV3Content({ report, provider }: { report: ReconReportV3; provider?: string }) {
  const assessment = report.assessmentOverview, narrative = report.narrative;
  const factualOnly = report.narrativeStatus === 'FACTUAL_ONLY';
  const warnings = factualOnly || report.narrativeStatus === 'RECOVERED' || report.warnings.length > 0;
  const unsupportedStructure=report.warnings.some(warning=>warning.code==='STRUCTURED_OUTPUT_UNSUPPORTED');
  const facts = presentReconFacts(report.factual);
  const synthesis = reconSynthesisPresentation(report);
  const fallbackText = String(report.narrativeFailure) === 'FAILED_PROVIDER_CONFIGURATION' ? 'The captured AI provider configuration is unavailable. Check its credentials in Settings, or regenerate with your current default. The Recon facts remain available.' :
    report.narrativeFailure === 'FAILED_PROVIDER' ? 'The AI provider did not return a usable response. Review the Recon facts and scope.md, or regenerate the AI synthesis later.' :
    report.narrativeFailure === 'FAILED_SCHEMA' ? 'The AI response could not be read as a report. Review the Recon facts and scope.md, or regenerate.' :
    report.narrativeFailure === 'FAILED_VALIDATION' ? 'The AI interpretation could not be verified against Recon evidence. Review the Recon facts and scope.md, or regenerate.' :
    'A validated AI narrative could not be produced. Review the Recon facts and scope.md, or regenerate the report.';
  return <>
    {warnings && <p role="status" className="text-sm">{factualOnly ? 'Recon facts are ready. The AI synthesis is unavailable; the evidence below remains usable.' : 'Report ready with warnings. Only interpretations supported by the retained evidence are shown.'}</p>}
    {unsupportedStructure&&<p role="status" className="text-sm">{provider==='OPENROUTER'?'This OpenRouter model or route':'The selected AI model or provider route'} does not support the required structured output. Choose a compatible model in Settings. Recon facts remain available.</p>}
    <section className="space-y-3" aria-label="Recon facts">
      <h3 className="font-semibold">Recon facts</h3>
      <p className="text-sm text-muted">Generated from structured Recon evidence. Discovered routes do not establish reachability, authorization or a vulnerability.</p>
      <h4 className="font-medium">Assessment Overview</h4>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">{[
        ['Asset', assessment.asset], ['Authorized scope', assessment.scopeBoundary], ['Format', formatLabel(assessment.format)],
        ['Type', typeLabel(assessment.assetType)], ['Asset Value', human(assessment.assetValue)], ['Recon status', human(assessment.reconStatus)], ['Tested at', assessment.testedAt],
      ].map(([label, value]) => <div key={label} className="contents"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}</dl>
      <p className="text-sm text-muted">{facts.count} factual entries · {facts.staticAssets} static assets summarized</p>
      {report.factual.truncated && <p role="status" className="text-sm">{report.factual.totals.omittedEvidence} additional evidence records exceed this report’s size limit. Full details remain in Recon artifacts and scope.md.</p>}
      {facts.sections.map(section => <section key={section.category} className="space-y-2" aria-label={section.title}>
        <h4 className="text-sm font-medium">{section.title} ({section.rows.length})</h4>
        <ul className="space-y-3 pt-2">{section.rows.map(({ row, primary }, index) => <li key={index} data-fact-row className="border-l-2 border-border pl-3 text-sm">
          <p data-fact-primary className="whitespace-pre-wrap break-words font-medium">{primary}</p>
          <p className="text-xs text-muted">{observationLabel(row.label)}</p>
          <p className="text-xs text-muted">{human(row.verification)} · {row.scopeState === 'IN_SCOPE' ? 'In scope' : row.scopeState === 'OUT_OF_SCOPE' ? 'Outside authorized scope — documentary only' : 'Scope not established'}</p>
          {Object.keys(row.details).length > 0 && <dl className="mt-1 space-y-1 text-xs text-muted">{Object.entries(row.details).map(([key, value]) => <div key={key}><dt className="inline font-medium">{human(key.replace(/([a-z])([A-Z])/g, '$1 $2'))}: </dt><dd className="inline break-words">{Array.isArray(value) ? value.join(', ') : String(value)}</dd></div>)}</dl>}
          <Evidence refs={row.evidenceRefs} />
          {row.sources.length > 0 && <details className="mt-1 text-xs text-muted"><summary>Sources</summary><ul>{row.sources.map((source, sourceIndex) => <li key={sourceIndex} className="break-all">{[source.tool, source.sourceRef, source.observedAt].filter(Boolean).join(' · ')}</li>)}</ul></details>}
        </li>)}</ul>
      </section>)}
      {!facts.count && <p className="text-sm text-muted">No displayable structured observations were retained for this report. Full evidence remains available in Recon artifacts and scope.md.</p>}
    </section>
    <section className="space-y-3" aria-label="AI synthesis">
      <h3 className="font-semibold">AI synthesis</h3>
      <p className="text-sm font-medium">AI synthesis: {synthesis.state}</p>
      {synthesis.failure && <p className="text-sm">Reason: {synthesis.failure}{synthesis.diagnostics.length > 0 && ` · ${synthesis.diagnostics.join(' · ')}`}</p>}
      <p className="text-xs text-muted">AI interpretation of the facts above. Verify it against the evidence; it is not a confirmed Finding.</p>
      {factualOnly ? <p className="text-sm">{fallbackText}</p> : <>
        <p className="whitespace-pre-wrap break-words">{narrative.attackSurfaceSummary}</p>
        <NarrativeEntries title="DNS and Host Intelligence" entries={narrative.dnsAndHostIntelligence} />
        <NarrativeEntries title="Network Surface" entries={narrative.networkSurface} />
        <NarrativeEntries title="Web Application Surface" entries={narrative.webSurface} />
        <NarrativeEntries title="API Surface" entries={narrative.apiSurface} />
        <NarrativeEntries title="Authentication Surface" entries={narrative.authenticationSurface} />
        <NarrativeEntries title="Technology Stack" entries={narrative.technologyFingerprint} />
        <NarrativeEntries title="TLS and Transport" entries={narrative.tlsAndTransport} />
        <NarrativeEntries title="Content Discovery" entries={narrative.contentDiscovery} />
        <NarrativeEntries title="Changes Since Previous Recon" entries={narrative.changesSincePreviousRecon} />
        {narrative.notableObservations.length > 0 && <section className="space-y-3"><h4 className="font-medium">Notable Observations</h4>{narrative.notableObservations.map((observation, index) => <article key={index}>
          <h5 className="text-sm font-medium">{observation.title}</h5><p className="break-words text-sm">{observation.observation}</p><p className="break-words text-sm text-muted">{observation.relevance} · {human(observation.confidence)}</p><Evidence refs={observation.evidenceRefs} />
        </article>)}</section>}
        {narrative.researchHandoff.length > 0 && <section className="space-y-3"><h4 className="font-medium">Recommended Research Focus</h4><ol className="space-y-3">{narrative.researchHandoff.map((focus, index) => <li key={index}>
          <p className="text-sm font-medium">{index + 1}. {focus.area} · {focus.priority} priority</p><p className="break-words text-sm">{focus.rationale}</p><Evidence refs={focus.evidenceRefs} />
        </li>)}</ol></section>}
        {narrative.limitations.length > 0 && <section><h4 className="font-medium">AI interpretation limits</h4><ul className="list-inside list-disc text-sm">{narrative.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></section>}
      </>}
    </section>
    <section className="space-y-2"><h3 className="font-semibold">Recon coverage</h3><p className="text-xs text-muted">Recorded by BugHunter from the completed run, independently of AI.</p>
      <dl className="space-y-2 text-sm">{(Object.keys(coverageLabels) as (keyof typeof coverageLabels)[]).filter(key => report.coverage[key].length > 0).map(key => <div key={key}><dt className="font-medium">{coverageLabels[key]}</dt><dd className="break-words text-muted">{report.coverage[key].join('; ')}</dd></div>)}</dl>
      <details className="text-sm"><summary>Methodology</summary><ol className="space-y-2 pt-2">{report.methodology.map((phase, index) => <li key={index}><p>{phase.phase} · {human(phase.status)}</p><p className="text-xs text-muted">{phase.tools.join(', ')}{phase.tools.length > 0 && ' · '}{phase.description}</p></li>)}</ol></details>
      <h4 className="font-medium">Limitations</h4><p className="text-sm text-muted">This report covers the retained observations and recorded coverage only. Missing observations do not establish the absence of a vulnerability. Refer to scope.md and the source artifacts for full evidence.</p>
    </section>
  </>;
}
