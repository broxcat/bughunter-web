import type { RunNarrative } from './reconRunNarrative';
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
  return String(value).replace(/(?<!\\)\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function table(headers: string[], rows: Array<Array<string | number | null>>): string {
  if (!rows.length) return '';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

/** Encode evidence as text even when a consumer enables raw HTML in Markdown. */
function markdownText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]{}|])/g, '\\$1').replace(/[\r\n]+/g, ' ');
}
function markdownValues<T>(value: T): T {
  if (typeof value === 'string') return markdownText(value) as T;
  if (Array.isArray(value)) return value.map(markdownValues) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, markdownValues(item)])) as T;
  return value;
}

export function renderReconReportMarkdown(input: ReconReportModel, narrative?:RunNarrative): string {
  const model = markdownValues(input);
  const out: string[] = [];
  const { metadata, authorization, methodology, web, authenticated } = model;

  out.push(`# ${model.title}`, '');
  out.push(`> Rapport déterministe produit à partir des preuves Recon enregistrées. Il ne démontre pas la sécurité de la cible (does not prove security) et une observation absente ne constitue pas une preuve d’absence.`, '');

  out.push('## Synthèse globale', '');
  out.push(`- **Programme :** ${metadata.program}${metadata.platform ? ` (${metadata.platform})` : ''}`);
  out.push(`- **Date de reconnaissance :** ${metadata.reconDate}`);
  out.push(`- **Durée :** ${metadata.duration ?? 'Non consignée'}`);
  out.push(`- **Résultat d’exécution :** ${metadata.outcomeLabel}${metadata.outcomeDetail ? ` — ${metadata.outcomeDetail}` : ''}`);
  out.push(`- **État du job :** ${metadata.status}`);
  out.push(`- **Mode d’évaluation :** ${metadata.assessmentMode}`);
  out.push(`- **Exécutions d’assets consignées :** ${metadata.hosts}`);
  out.push(`- **Étapes :** ${metadata.stageCounts.completed} terminées, ${metadata.stageCounts.partial} partielles, ${metadata.stageCounts.failed} en échec, ${metadata.stageCounts.skipped} ignorées/non applicables, ${metadata.stageCounts.unknown} inconnues`);
  out.push(`- **Observations consignées :** ${model.observationsTotal}`, '');

  if (model.limitations.length) {
    out.push('**Principales limites**', '');
    for (const item of model.limitations.slice(0, 8)) out.push(`- ${item.host} · ${item.stage}: ${item.label}${item.reason ? ` — ${item.reason}` : ''}`);
    out.push('');
  }

  out.push('## Synthèse IA facultative','');
  if(narrative?.state==='AI_ASSISTED'){out.push(`AI-assisted evidence highlights (${markdownText(narrative.provider??'Not recorded')} · ${markdownText(narrative.model??'Not recorded')}).`,'');for(const row of narrative.highlights)out.push(`- ${markdownText(row.text)} — Evidence: ${row.refs.map(markdownText).join(', ')}`);}
  else out.push('Deterministic fallback. Optional AI synthesis is unavailable or not generated.');
  out.push('','AI selects evidence; application-written facts remain authoritative. Report reads never generate AI content.','');

  out.push('## Périmètre et autorisation', '');
  out.push(authorization.note, '');
  out.push(`- **Authorized assets:** ${authorization.authorized.length ? authorization.authorized.join(', ') : 'None recorded'}`);
  out.push(`- **Observed hosts (not authorization):** ${authorization.observed.length ? authorization.observed.join(', ') : 'None recorded'}`);
  out.push(`- **Captured exclusions:** ${authorization.excluded.length ? authorization.excluded.join(', ') : authorization.exclusionsRecorded ? 'None (captured policy)' : 'Not recorded'}`);
  out.push(`- **Required User-Agent:** ${authorization.userAgent ?? 'Not recorded'}`);
  out.push(`- **Engagement rules:** ${authorization.rules ? authorization.rules : 'Not recorded'}`, '');

  out.push('## Méthode', '');
  if (methodology.stages.length) {
    out.push(table(['Planned stage', 'Planned tools'], methodology.stages.map(stage => [stage.name, stage.tools.join(', ') || 'None recorded'])));
    out.push('');
  } else {
    out.push('No stage detail was recorded for this run.', '');
  }
  out.push(`- **Authenticated contexts:** ${methodology.authenticated ? 'recorded' : 'none recorded'}`);
  out.push(`- **Activity:** ${methodology.activity === 'UNKNOWN' ? 'Not recorded' : methodology.activity.toLowerCase() + ' (captured plan)'}`, '');

  out.push('## Exécution technique', '');
  if (model.execution.length) {
    out.push(table(['Host', 'Phase', 'Tool', 'Result', 'Notes'], model.execution.map(line => [line.host, line.name, line.tools.join(', ') || 'Not recorded', line.label, line.reason])));
    out.push('');
  } else {
    out.push('No stage detail was recorded for this run.', '');
  }

  out.push('## Outils et commandes', '');
  if (model.tools.length) {
    out.push(table(['Tool', 'Version', 'Invocation'], model.tools.map(tool => [tool.name, tool.version, tool.invocation ?? 'Invocation not recorded'])));
    out.push('', 'Commands are shown only when the execution stored them. A tool name alone is never expanded into a command.', '');
  } else {
    out.push('No tool was recorded for this run.', '');
  }

  out.push('## DNS et hôtes (DNS and Hosts)', '');
  if (!model.dnsRecords.some(row=>row.value!==null)) out.push(model.evidenceTruncated?'DNS evidence not included in the bounded report inventory; consult retained artifacts.':'DNS evidence not recorded for this run.', '');
  if (model.dnsRecords.length) out.push(table(['Hostname','Record type','Resolved value / destination','Authorization relationship','Evidence'],model.dnsRecords.map(r=>[r.host,r.recordType??'Not recorded',r.value,r.relationship,r.refs.join(', ')||'Not recorded'])), '');
  out.push('Observed names and DNS destinations never grant authorization. Missing evidence is not NXDOMAIN.', '');
  out.push('## Preuves TLS (TLS Evidence)', '');
  if(model.tls.length) for(const row of model.tls) out.push(`- ${row.host}: ${row.properties.map(p=>`${p.name}: ${p.value}`).join('; ')||'Certificate properties not recorded'}. Evidence: ${row.refs.join(', ')||'Not recorded'}`);
  else out.push(model.evidenceTruncated?'TLS evidence not included in the bounded report inventory; consult retained artifacts.':'TLS evidence not recorded for this run.');
  out.push('', 'Unlisted certificate properties, SANs, validation, protocol and cipher were not recorded. HTTPS alone does not establish TLS details or open ports.', '');
  out.push('## Redirections observées', '');
  if(model.redirects.length) out.push(table(['Origin','Destination','Evidence'],model.redirects.map(r=>[r.from,r.to,r.refs.join(', ')||'Not recorded'])));
  else out.push('No redirect observation recorded.');
  out.push('', 'A redirect does not prove that its destination was requested.', '');
  out.push('## Ressources statiques', '');
  for(const group of model.staticAssets){out.push(`- **${group.category}:** ${group.count} resources in report inventory${group.truncated?' (first 5 shown)':''}`);for(const sample of group.samples)out.push(`  - ${sample.url} — Evidence: ${sample.refs.join(', ')||'Not recorded'}`);}
  if(!model.staticAssets.length)out.push('Static asset evidence not recorded in the report inventory.');
  out.push('',model.evidenceTruncated?'Evidence is truncated; counts are lower bounds.':'Counts cover the retained report inventory.','Static resources are not vulnerabilities or proof of secrets.','');
  out.push('## Provenance des preuves', '');
  out.push(table(['Fact','Evidence ID','ScanRun','TargetReconRun','Host/context','Verification / scope','Source','First / last observed'],model.provenance.map(r=>[r.fact,`${r.entity}: ${r.id??'Not recorded'}`,r.scanRunId,r.runId,r.host,`${r.verification} / ${r.scopeState}`,r.sources.join('; ')||'Not recorded',`${r.firstSeenAt??'Not recorded'} / ${r.lastSeenAt??'Not recorded'}`])), '');

  out.push('## Ports et services', '');
  if (model.network.length) {
    out.push(table(['Host', 'Port', 'Protocol', 'Service', 'State', 'Evidence'], model.network.map(row => [row.host, row.port, row.protocol, row.service, row.state, row.source])), '');
  } else if (model.evidenceTruncated) {
    out.push('No port/service observation included in the bounded report inventory; consult retained artifacts.', '');
  } else if (model.portDiscoveryPerformed) {
    out.push('Port discovery ran but recorded no open service observation.', '');
  } else {
    out.push('No port discovery execution was recorded; network coverage remains unknown.', '');
  }

  out.push('## Surface Web', '');
  out.push(`- **Responsive hosts:** ${web.responsiveHosts.length ? web.responsiveHosts.join(', ') : 'None recorded'}`);
  out.push(`- **HTTP status codes observed:** ${web.statusCodes.length ? web.statusCodes.join(', ') : 'None recorded'}`);
  out.push(`- **Authentication signals (unverified):** ${web.authSurfaces.length ? web.authSurfaces.join(', ') : 'None recorded'}`);
  out.push(`- **API signals (unverified):** ${web.apiSurfaces.length ? web.apiSurfaces.join(', ') : 'None recorded'}`);
  out.push(`- **Technologies:** ${web.technologies.length ? web.technologies.map(tech => `${tech.name}${tech.version ? ` ${tech.version}` : ' (version unconfirmed)'}`).join(', ') : 'None recorded'}`, '');
  if (web.endpoints.length) {
    out.push(table(['Endpoint', 'Method', 'Status'], web.endpoints.slice(0, 200).map(endpoint => [endpoint.url, endpoint.method, endpoint.status])), '');
    if (web.endpoints.length > 200) out.push(`Only the first 200 of ${web.endpoints.length} endpoints are listed here; the full inventory remains in the artifacts.`, '');
  }
  out.push('Observed endpoints are evidence, not confirmed vulnerabilities.', '');

  out.push('## Reconnaissance authentifiée', '');
  out.push(authenticated.note ?? 'No authenticated Recon context was recorded for this run.', '');
  if (authenticated.contexts.length) {
    out.push(table(['Context', 'Captured state', 'Usable observations'], authenticated.contexts.map(context => [context.label, context.state, context.observations])), '');
  }

  out.push('## Erreurs et limites', '');
  if (model.limitations.length) {
    out.push(table(['Host', 'Stage', 'State', 'Reason'], model.limitations.map(item => [item.host, item.stage, item.label, item.reason])), '');
  } else {
    out.push('No stage reported a failure, partial result, skip or cancellation.', '');
  }
  out.push('Unrecorded coverage is unknown; it is never reported as safe.', '');

  out.push('## Changements depuis la reconnaissance précédente', '');
  if (model.changes) {
    out.push(table(['New', 'Changed', 'Not observed', 'Unchanged'], [[model.changes.new, model.changes.changed, model.changes.notObserved, model.changes.unchanged]]), '');
    out.push(model.changes.note, '');
  } else {
    out.push('No comparison data was recorded for this run.', '');
  }

  out.push('## Inventaire des hôtes', '');
  out.push(`- **Référence du rapport:** ${model.report.reportId}`);
  out.push(`- **Sélection:** un run (${model.report.selection.runIds.join(', ')})`);
  out.push(`- **Généré:** ${model.report.generatedAt}`);
  out.push(`- **Format:** ${model.report.formatVersion}`, '');
  out.push(table(['Hôte','Scope','Testé','Répondant','Services','Origines HTTP','Priorité','Dernière observation'],model.report.hosts.map(h=>[h.host,h.scope,h.tested?'Oui':'Non',h.responding?'Oui':'Non',h.services.length,h.origins.length,`${h.priority}: ${h.priorityReason}`,h.lastObservedAt])), '');
  out.push('### Sommaire des fiches', '');
  for(const h of model.report.hosts)out.push(`- [${h.host}](#${h.id})`);
  out.push('');
  for(const h of model.report.hosts){
    out.push(`### ${h.id}`,'',`**Hôte:** ${h.host}  `,`**Scope:** ${h.scope}  `,`**Collecte:** ${h.collection}  `,`**Priorité:** ${h.priority} — ${h.priorityReason}`,'');
    out.push('#### Couverture','',table(['Famille','État','Détail','Preuves'],h.coverage.map(c=>[c.family,c.state,c.detail,c.evidenceRefs.join(', ')||'Référence absente'])),'');
    out.push('#### DNS et relations','');
    if(h.dns.length)out.push(table(['Type','Valeur','Relation','Preuves'],h.dns.map(d=>[d.type,d.value,d.relationship,d.evidenceRefs.join(', ')||'Référence absente'])),'');else out.push('Non collecté ou non disponible dans ce run.','');
    out.push('#### Ports et services','');
    if(h.services.length)out.push(table(['Port','Transport','État','Service','Date','Preuves'],h.services.map(s=>[s.port,s.transport,s.state,s.name,s.observedAt,s.evidenceRefs.join(', ')||'Référence absente'])),'');else out.push('Aucune observation de port ou service; la surface reste inconnue.','');
    out.push('#### Applications et origines HTTP','');
    if(!h.origins.length)out.push('Aucune origine HTTP consignée.','');
    for(const origin of h.origins){out.push(`##### ${origin.origin}`,'',`Entrée: ${origin.entryUrl} · Statut: ${origin.status??'non consigné'} · Date: ${origin.observedAt??'non disponible'}`,'',table(['URL','Méthode','Réponse','Type','Contexte','Preuves'],origin.endpoints.map(e=>[e.url,e.method,e.observed?(e.status??'Réponse observée'):'URL extraite, sans réponse directe',e.classification,e.context,e.evidenceRefs.join(', ')||'Référence absente'])),'');}
    out.push('#### Signaux de sécurité','');
    if(h.signals.length)for(const signal of h.signals)out.push(`- **${signal.title}** — ${signal.detail} — Confiance: ${signal.confidence} — Preuves: ${signal.evidenceRefs.join(', ')||'Référence absente'}`);else out.push('Aucun signal scanner consigné; cela ne vaut pas absence de vulnérabilité.');
    out.push('','#### Limites propres à l’hôte','');for(const limit of h.limitations.length?h.limitations:['Aucune limite explicite enregistrée; la couverture non consignée reste inconnue.'])out.push(`- ${limit}`);out.push('');
  }
  out.push('## Relations transversales','');
  if(model.report.relations.length)out.push(table(['Source','Relation','Destination','Confiance','Preuves'],model.report.relations.map(r=>[r.from,r.relation,r.to,r.confidence,r.evidenceRefs.join(', ')||'Référence absente'])),'');else out.push('Aucune relation transversale étayée.','');
  out.push('## Priorités globales','');
  if(model.report.priorities.length)for(const p of model.report.priorities)out.push(`- **${p.priority} — ${p.title}** · ${p.host} · ${p.service} — ${p.reason} — Preuves: ${p.evidenceRefs.join(', ')||'Référence absente'}`);else out.push('Aucune priorité étayée ne ressort des preuves sélectionnées.');
  out.push('',`Limite d’inventaire: ${model.report.limits.artifactsPerHost} artefacts par hôte. ${model.report.limits.note}`,'');

  out.push('## Transmission vers l’investigation', '');
  for (const item of model.researchHandoff) out.push(`- ${item}`);
  out.push('', 'These priorities come from recorded evidence only. No Finding is created automatically.', '');

  return out.join('\n');
}
