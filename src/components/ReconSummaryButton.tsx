'use client';
import { useCallback,useEffect,useState } from 'react';
import Link from 'next/link';
import ReconReportContent from './ReconReportContent';
import ReconReportV3Content from './ReconReportV3Content';
import type { ReconReport } from '@/lib/reconReport';
import type { ReconReportV3 } from '@/lib/reconReportV3';
import type { ReconSummaryContent } from '@/lib/reconSummary';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
type Summary={status:string;provider?:string;model:string;promptVersion:string;generatedAt:string|null;scanRunId:string|null;targetReconRunId:string|null;sourceFingerprint?:string;content:ReconSummaryContent|ReconReport|ReconReportV3|null;error:string|null};
type Provider={provider:string;model:string};
type ConfigurationIssue='NO_DEFAULT_PROVIDER'|'INVALID_DEFAULT_PROVIDER';
type SummaryView={summary:Summary|null;stale:boolean;defaultProvider:Provider|null;defaultChanged:boolean;configurationIssue?:ConfigurationIssue};
class SummaryRequestError extends Error {}
const unavailable='The report is unavailable. Existing Recon data and scope.md are unchanged. Check your default AI provider in Settings, then try again.';
const providerName=(value?:string)=>value==='OPENROUTER'?'OpenRouter':value==='OLLAMA'||!value?'Ollama':value.replaceAll('_',' ');
const requestError=(error:unknown)=>error instanceof SummaryRequestError?error.message:unavailable;
export function ReconSummaryProviderDetails({summary}:{summary:Pick<Summary,'provider'|'model'|'promptVersion'>}){return <p className="text-xs text-muted">Provider: {providerName(summary.provider)} · Model: {summary.model} · Prompt: {summary.promptVersion}</p>;}
export function ReconSummaryRoutingNotice({issue,changed,current}:{issue?:ConfigurationIssue;changed:boolean;current:Provider|null}){
  if(issue)return <p role="status">{issue==='NO_DEFAULT_PROVIDER'?'Choose a default AI provider in Settings to generate a new synthesis.':'The default AI provider needs attention in Settings before generating a new synthesis.'} Existing reports, Recon facts and scope.md remain available. <Link href="/settings" className="underline">Open Settings</Link></p>;
  return changed&&current?<p role="status">The default AI provider is now {providerName(current.provider)} ({current.model}). This stored report remains unchanged. Regenerate to use the new default.</p>:null;
}
export function ReconSummaryUnavailable({sourceUnavailable=false}:{sourceUnavailable?:boolean}){return <p role="status">{sourceUnavailable?'The Recon source is unavailable or its authorization has changed. Review the current scope before generating another report.':'The report is unavailable. Review scope.md or regenerate if Recon is still available.'}</p>;}
export default function ReconSummaryButton({programId,assetId}:{programId:string;assetId?:string}){
  const[open,setOpen]=useState(false),[summary,setSummary]=useState<Summary|null>(null),[stale,setStale]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[current,setCurrent]=useState<Provider|null>(null),[defaultChanged,setDefaultChanged]=useState(false),[configurationIssue,setConfigurationIssue]=useState<ConfigurationIssue>();
  const url=`/api/programs/${programId}/${assetId?`assets/${assetId}/`:''}summary`;
  const request=useCallback(async(method='GET',regenerate=false)=>{const r=await fetch(url,{method,cache:'no-store',...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({regenerate})}:{})});const j=await r.json().catch(()=>null);if(!r.ok||!j){const code=typeof j?.code==='string'?j.code:typeof j?.error==='string'?j.error.split(':')[0]:'';throw new SummaryRequestError(r.status===401?'Your session has expired. Sign in and try again.':r.status===403?'You do not have permission to view this report.':code==='NO_DEFAULT_PROVIDER'?'Choose a default AI provider in Settings before generating a synthesis. Recon facts and scope.md are still available.':code==='FAILED_PROVIDER_CONFIGURATION'?'Check the default AI provider, model and credentials in Settings. Recon facts and scope.md are still available.':unavailable);}const view=j as SummaryView;setSummary(view.summary);setStale(view.stale);setCurrent(view.defaultProvider??null);setDefaultChanged(Boolean(view.defaultChanged));setConfigurationIssue(view.configurationIssue);setError('');return view;},[url]);
  const generate=async(regenerate:boolean)=>{setBusy(true);setError('');try{await request('POST',regenerate);}catch(e){setError(requestError(e));}finally{setBusy(false);}};
  const show=async()=>{setOpen(true);setBusy(true);setError('');try{const view=await request();if(!view.summary&&!view.configurationIssue)await request('POST');}catch(e){setError(requestError(e));}finally{setBusy(false);}};
  const waiting=summary&&['PENDING','RUNNING'].includes(summary.status);
  useEffect(()=>{if(!open||!waiting)return;const timer=setInterval(()=>{void request().catch(e=>setError(requestError(e)));},2000);return()=>clearInterval(timer);},[open,waiting,request]);
  const payload=summary?.content;
  const reportV3=payload&&'version' in payload&&payload.version===3?payload as ReconReportV3:null;
  const report=payload&&!reportV3&&'assessmentOverview' in payload?payload as ReconReport:null;
  const content=payload&&!reportV3&&!report?payload as ReconSummaryContent:null;
  return <>
    <Button size="sm" variant="secondary" onClick={()=>void show()}>Summary</Button>
    {open&&<Dialog title={report||reportV3?'Reconnaissance & attack surface assessment':'Recon summary'} onClose={()=>setOpen(false)}>
      <div className="space-y-5">
        {error&&<p role="alert" className="text-danger">{error}</p>}
        {busy&&<p role="status">Loading…</p>}
        {waiting&&<p role="status">{summary.status==='PENDING'?'Queued for the summary worker…':'Generating summary…'}</p>}
        {stale&&<p role="status">Recon data, scope or report format has changed. This stored report remains unchanged until regenerated. Verify current authorization before Research.</p>}
        <ReconSummaryRoutingNotice issue={configurationIssue} changed={defaultChanged} current={current}/>
        {summary&&<><ReconSummaryProviderDetails summary={summary}/><p className="text-xs text-muted">{reportV3?'Recon evidence with a separate AI synthesis':'LLM-generated'} · {summary.generatedAt?new Date(summary.generatedAt).toLocaleString():waiting?'In progress':'Not generated'}<br/>Recon: {summary.scanRunId??summary.targetReconRunId}{summary.sourceFingerprint&&<><br/>Source fingerprint: {summary.sourceFingerprint.slice(0,16)}</>}</p></>}
        {reportV3&&<ReconReportV3Content report={reportV3} provider={summary?.provider}/>}
        {report&&<ReconReportContent report={report}/>}
        {content&&<><section><h3 className="font-semibold">Overview</h3><p className="whitespace-pre-wrap break-words">{content.executiveSummary}</p></section>{content.sections.filter(s=>s.items.length).map((s,i)=><section key={i}><h3 className="font-semibold">{s.title}</h3><ul className="list-inside list-disc space-y-2">{s.items.map((item,j)=><li key={j} className="break-words">{item.text}<details className="ml-4 text-xs text-muted"><summary>Evidence</summary>{item.evidenceRefs.join(', ')}</details></li>)}</ul></section>)}<section><h3 className="font-semibold">Suggested research priorities</h3><ol className="list-inside list-decimal space-y-2">{content.researchPriorities.map((p,i)=><li key={i}>{p.text}<p className="text-xs text-muted">Evidence: {p.evidenceRefs.join(', ')}</p></li>)}</ol></section><section><h3 className="font-semibold">Limitations</h3><ul className="list-inside list-disc">{content.limitations.map((l,i)=><li key={i}>{l}</li>)}</ul></section><p className="text-xs text-muted">AI interpretation; verify against scope.md and original evidence. A research priority is not a confirmed vulnerability.</p></>}
        {report&&<p className="text-xs text-muted">AI-generated reconnaissance narrative. Verify evidence and scope before manual investigation; this is not a vulnerability assessment or a Finding.</p>}
        {!reportV3&&!waiting&&summary&&(summary.error||['FAILED','CANCELLED'].includes(summary.status))&&<ReconSummaryUnavailable sourceUnavailable={/^(?:SOURCE_REVOKED|SOURCE_UNAVAILABLE|DATA_UNAVAILABLE):/.test(summary.error??'')}/>}
        <Button variant="secondary" size="sm" disabled={busy||Boolean(waiting)||Boolean(configurationIssue)} onClick={()=>void generate(true)}>{summary?'Regenerate':'Generate'}</Button>
      </div>
    </Dialog>}
  </>;
}
