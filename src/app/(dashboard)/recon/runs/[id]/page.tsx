import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import ReconRunRefresh from '@/components/ReconRunRefresh';
import ReconDiscoveredHosts from '@/components/ReconDiscoveredHosts';
import { loadTargetReconRun } from '@/server/recon/runDetail';
import { ResearchError } from '@/server/research/workspace';
import { reconOverview, type ReconTone } from '@/lib/reconOverview';
import { elapsed } from '@/lib/reconTimeline';
import { buildReconReportModel } from '@/lib/reconReportModel';
import { loadReconReportFacts } from '@/server/recon/reportFacts';
import { redactObservationText } from '@/lib/observationSafety';

export const dynamic='force-dynamic';

const badgeTone:Record<ReconTone,'neutral'|'brand'|'passed'|'medium'|'killed'>={
  idle:'neutral',active:'brand',success:'passed',warning:'medium',danger:'killed',
};

function authorizedHost(host:string,values:string[]){
  return values.some(value=>{
    try{
      const candidate=value.startsWith('http://')||value.startsWith('https://')?new URL(value).hostname:value;
      return candidate.startsWith('*.')?host.endsWith(candidate.slice(1))&&host!==candidate.slice(2):candidate===host;
    }catch{return false;}
  });
}

export default async function ReconRunPage({params}:{params:Promise<{id:string}>}){
  const{id}=await params;
  const session=await auth();
  if(!session?.user?.id)redirect('/login');

  let detail:Awaited<ReturnType<typeof loadTargetReconRun>>;
  try{detail=await loadTargetReconRun(session.user.id,id);}
  catch(error){if(error instanceof ResearchError&&error.status===404)notFound();throw error;}

  const facts=await loadReconReportFacts(session.user.id,id);
  const report=buildReconReportModel(facts);
  const {run}=detail;
  const view=reconOverview({status:run.status,outcome:run.outcome});
  const duration=elapsed(run.startedAt??run.createdAt,run.finishedAt);
  const discovered=report.authorization.observed
    .filter(host=>!authorizedHost(host,report.authorization.authorized))
    .filter(host=>!authorizedHost(host,report.authorization.excluded))
    .map(host=>({host,responsive:report.web.responsiveHosts.includes(host)}));

  return <div className="max-w-5xl space-y-6">
    <ReconRunRefresh programId={run.program.id} runId={run.id} status={run.status}/>

    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Link href={'/targets/'+run.program.id} className="text-brand">← {run.program.companyName}</Link>
      <Link href={'/recon?program='+run.program.id} className="text-brand">Recon history</Link>
    </div>

    <header className="space-y-3 rounded border border-border p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Recon results</h1>
        <Badge tone={badgeTone[view.tone]}>{view.label}</Badge>
        <a className="ml-auto text-sm text-brand underline" href={'/api/recon/runs/'+run.id+'/report'}>Download technical report</a>
      </div>
      {view.detail&&<p className="text-sm text-muted">{view.detail}</p>}
      <p className="text-sm text-muted">{run.scans.length} asset execution{run.scans.length===1?'':'s'} · {duration??'Duration not recorded'} · {report.observationsTotal} observations</p>
    </header>

    <section className="space-y-3 rounded border border-border p-5">
      <div><h2 className="text-lg font-semibold">Discovered hosts</h2><p className="text-sm text-muted">Review discoveries before promoting them into the target scope.</p></div>
      <ReconDiscoveredHosts programId={run.program.id} candidates={discovered}/>
    </section>

    <section className="space-y-4 rounded border border-border p-5">
      <h2 className="text-lg font-semibold">Useful attack surface</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-subtle">Responsive hosts</dt><dd className="break-all">{report.web.responsiveHosts.join(', ')||'None recorded'}</dd></div>
        <div><dt className="text-subtle">Technologies</dt><dd>{report.web.technologies.map(item=>item.name+(item.version?' '+item.version:'')).join(', ')||'None recorded'}</dd></div>
        <div><dt className="text-subtle">Authentication surfaces</dt><dd className="break-all">{report.web.authSurfaces.join(', ')||'None recorded'}</dd></div>
        <div><dt className="text-subtle">API surfaces</dt><dd className="break-all">{report.web.apiSurfaces.join(', ')||'None recorded'}</dd></div>
      </dl>
      {report.web.endpoints.length>0&&<details><summary className="cursor-pointer text-sm font-medium">Endpoints ({report.web.endpoints.length})</summary>
        <ul className="mt-3 max-h-72 space-y-1 overflow-auto text-xs">{report.web.endpoints.slice(0,100).map(endpoint=><li key={endpoint.url} className="break-all font-mono">{endpoint.method??'GET'} {endpoint.url}{endpoint.status?(' · '+endpoint.status):''}</li>)}</ul>
      </details>}
    </section>

    {(report.changes||report.limitations.length>0)&&<section className="grid gap-4 sm:grid-cols-2">
      {report.changes&&<div className="space-y-2 rounded border border-border p-5">
        <h2 className="font-semibold">Changes since previous recon</h2>
        <p className="text-sm">{report.changes.new} new · {report.changes.changed} changed · {report.changes.notObserved} not observed</p>
        <p className="text-xs text-muted">{report.changes.note}</p>
      </div>}
      <div className="space-y-2 rounded border border-border p-5">
        <h2 className="font-semibold">Coverage gaps</h2>
        {report.limitations.length?<ul className="space-y-1 text-sm">{report.limitations.slice(0,8).map(item=><li key={item.host+item.stage}><strong>{item.host}</strong> · {item.stage}: {item.label}{item.reason?' — '+item.reason:''}</li>)}</ul>:<p className="text-sm text-muted">No execution limitation was recorded.</p>}
      </div>
    </section>}

    <section className="space-y-2 rounded border border-border p-5">
      <h2 className="font-semibold">Research handoff</h2>
      <ul className="space-y-1 text-sm">{report.researchHandoff.map(item=><li key={item}>• {item}</li>)}</ul>
      <Link className="inline-block text-sm text-brand underline" href={'/research?program='+run.program.id+'&view=details'}>Choose hosts for Research →</Link>
    </section>

    <details className="ui-disclosure">
      <summary>Technical details</summary>
      <div className="mt-4 space-y-3 text-sm">
        <p>Run ID: <code>{run.id}</code></p>
        {run.scans.map(scan=><div key={scan.id} className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <span className="break-all font-mono">{redactObservationText(scan.capturedHost??'Host not captured')}</span>
          <span className="text-muted">{scan.status.toLowerCase()}{scan.outcome?' · '+scan.outcome.toLowerCase():''}</span>
          <span className="text-muted">{scan._count.artifacts} observations</span>
          {scan.scopeAsset&&<Link className="ml-auto text-brand underline" href={'/scopes/'+scan.scopeAsset.id}>Open evidence</Link>}
        </div>)}
      </div>
    </details>
  </div>;
}
