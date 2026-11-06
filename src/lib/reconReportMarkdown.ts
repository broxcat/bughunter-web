/**
 * Markdown export for the deterministic Recon report.
 *
 * Plain Markdown only: no raw HTML, no links generated from model output, and
 * every value comes from the already-derived report model.
 */
import type { ReconReportModel } from './reconReportModel';

/** Escape pipe characters and collapse line breaks so a value cannot break a table. */
export function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function table(headers: string[], rows: Array<Array<string | number | null>>): string {
  if (!rows.length) return '';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

export function renderReconReportMarkdown(model: ReconReportModel): string {
  const out: string[] = [];
  const { metadata, authorization, methodology, web, authenticated } = model;

  out.push(`# ${model.title}`, '');
  out.push(`> Deterministic report generated from stored Recon evidence. It does not prove security, and missing observations are not evidence of absence.`, '');

  out.push('## Executive Summary', '');
  out.push(`- **Program:** ${metadata.program}${metadata.platform ? ` (${metadata.platform})` : ''}`);
  out.push(`- **Recon date:** ${metadata.reconDate}`);
  out.push(`- **Duration:** ${metadata.duration ?? 'Not recorded'}`);
  out.push(`- **Execution result:** ${metadata.outcomeLabel}${metadata.outcomeDetail ? ` — ${metadata.outcomeDetail}` : ''}`);
  out.push(`- **Job status:** ${metadata.status}`);
  out.push(`- **Assessment mode:** ${metadata.assessmentMode}`);
  out.push(`- **Hosts assessed:** ${metadata.hosts}`);
  out.push(`- **Stages:** ${metadata.stageCounts.completed} completed, ${metadata.stageCounts.partial} partial, ${metadata.stageCounts.failed} failed, ${metadata.stageCounts.skipped} skipped/not applicable, ${metadata.stageCounts.unknown} unknown`);
  out.push(`- **Recorded observations:** ${model.observationsTotal}`, '');

  if (model.limitations.length) {
    out.push('**Major limitations**', '');
    for (const item of model.limitations.slice(0, 8)) out.push(`- ${item.host} · ${item.stage}: ${item.label}${item.reason ? ` — ${item.reason}` : ''}`);
    out.push('');
  }

  out.push('## Scope and Authorization', '');
  out.push(authorization.note, '');
  out.push(`- **Authorized assets:** ${authorization.authorized.length ? authorization.authorized.join(', ') : 'None recorded'}`);
  out.push(`- **Observed hosts (not authorization):** ${authorization.observed.length ? authorization.observed.join(', ') : 'None recorded'}`);
  out.push(`- **Exclusions applied:** ${authorization.excluded.length ? authorization.excluded.join(', ') : 'None recorded'}`);
  out.push(`- **Required User-Agent:** ${authorization.userAgent ?? 'Not recorded'}`);
  out.push(`- **Engagement rules:** ${authorization.rules ? authorization.rules : 'Not recorded'}`, '');

  out.push('## Methodology', '');
  if (methodology.stages.length) {
    out.push(table(['Stage', 'Recorded tools'], methodology.stages.map(stage => [stage.name, stage.tools.join(', ') || 'None recorded'])));
    out.push('');
  } else {
    out.push('No stage detail was recorded for this run.', '');
  }
  out.push(`- **Authenticated contexts:** ${methodology.authenticated ? 'recorded' : 'none recorded'}`);
  out.push(`- **Activity:** ${methodology.passiveOnly ? 'passive stages only, as recorded' : 'includes active stages, as recorded'}`, '');

  out.push('## Execution Overview', '');
  if (model.execution.length) {
    out.push(table(['Host', 'Phase', 'Tool', 'Result', 'Notes'], model.execution.map(line => [line.host, line.name, line.tools.join(', ') || 'Not recorded', line.label, line.reason])));
    out.push('');
  } else {
    out.push('No stage detail was recorded for this run.', '');
  }

  out.push('## Tools and Commands', '');
  if (model.tools.length) {
    out.push(table(['Tool', 'Version', 'Invocation'], model.tools.map(tool => [tool.name, tool.version, tool.invocation ?? 'Invocation not recorded'])));
    out.push('', 'Commands are shown only when the execution stored them. A tool name alone is never expanded into a command.', '');
  } else {
    out.push('No tool was recorded for this run.', '');
  }

  out.push('## DNS and Hosts', '');
  if (model.dns.length) {
    out.push(table(['Host', 'Evidence source'], model.dns.map(row => [row.host, row.source])), '');
  } else {
    out.push('No host or DNS observation was recorded.', '');
  }

  out.push('## Ports and Services', '');
  if (model.network.length) {
    out.push(table(['Host', 'Port', 'Protocol', 'Service', 'Evidence'], model.network.map(row => [row.host, row.port, row.protocol, row.service, row.source])), '');
  } else if (model.portDiscoveryPerformed) {
    out.push('Port discovery ran but recorded no open service observation.', '');
  } else {
    out.push('Port discovery was not performed for this run.', '');
  }

  out.push('## Web Surface', '');
  out.push(`- **Responsive hosts:** ${web.responsiveHosts.length ? web.responsiveHosts.join(', ') : 'None recorded'}`);
  out.push(`- **HTTP status codes observed:** ${web.statusCodes.length ? web.statusCodes.join(', ') : 'None recorded'}`);
  out.push(`- **Authentication entry points:** ${web.authSurfaces.length ? web.authSurfaces.join(', ') : 'None recorded'}`);
  out.push(`- **API surfaces:** ${web.apiSurfaces.length ? web.apiSurfaces.join(', ') : 'None recorded'}`);
  out.push(`- **Technologies:** ${web.technologies.length ? web.technologies.map(tech => `${tech.name}${tech.version ? ` ${tech.version}` : ' (version unconfirmed)'}`).join(', ') : 'None recorded'}`, '');
  if (web.endpoints.length) {
    out.push(table(['Endpoint', 'Method', 'Status'], web.endpoints.slice(0, 200).map(endpoint => [endpoint.url, endpoint.method, endpoint.status])), '');
    if (web.endpoints.length > 200) out.push(`Only the first 200 of ${web.endpoints.length} endpoints are listed here; the full inventory remains in the artifacts.`, '');
  }
  out.push('Observed endpoints are evidence, not confirmed vulnerabilities.', '');

  out.push('## Authenticated Recon', '');
  out.push(authenticated.note ?? 'No authenticated Recon context was recorded for this run.', '');
  if (authenticated.contexts.length) {
    out.push(table(['Context', 'Public observations', 'Authenticated-only'], authenticated.contexts.map(context => [context.label, context.publicObservations, context.authenticatedOnly])), '');
  }

  out.push('## Errors and Limitations', '');
  if (model.limitations.length) {
    out.push(table(['Host', 'Stage', 'State', 'Reason'], model.limitations.map(item => [item.host, item.stage, item.label, item.reason])), '');
  } else {
    out.push('No stage reported a failure, partial result, skip or cancellation.', '');
  }
  out.push('Unrecorded coverage is unknown; it is never reported as safe.', '');

  out.push('## Changes Since Previous Recon', '');
  if (model.changes) {
    out.push(table(['New', 'Changed', 'Not observed', 'Unchanged'], [[model.changes.new, model.changes.changed, model.changes.notObserved, model.changes.unchanged]]), '');
    out.push(model.changes.note, '');
  } else {
    out.push('No comparison data was recorded for this run.', '');
  }

  out.push('## Research Handoff', '');
  for (const item of model.researchHandoff) out.push(`- ${item}`);
  out.push('', 'These priorities come from recorded evidence only. No Finding is created automatically.', '');

  return out.join('\n');
}
