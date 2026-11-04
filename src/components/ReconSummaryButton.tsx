'use client';
import { useCallback,useEffect,useState } from 'react';
import ReconReportContent from './ReconReportContent';
import ReconReportV3Content from './ReconReportV3Content';
import type { ReconReport } from '@/lib/reconReport';
import type { ReconReportV3 } from '@/lib/reconReportV3';
import type { ReconSummaryContent } from '@/lib/reconSummary';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
type Summary={status:string;model:string;promptVersion:string;generatedAt:string|null;scanRunId:string|null;targetReconRunId:string|null;sourceFingerprint?:string;content:ReconSummaryContent|ReconReport|ReconReportV3|null;error:string|null};
class SummaryRequestError extends Error {}
const unavailable='The report is unavailable. Existing Recon data and scope.md are unchanged. Check Ollama in Settings, then try again.';
const requestError=(error:unknown)=>error instanceof SummaryRequestError?error.message:unavailable;
export function ReconSummaryUnavailable({sourceUnavailable=false}:{sourceUnavailable?:boolean}){return <p role="status">{sourceUnavailable?'The Recon source is unavailable or its authorization has changed. Review the current scope before generating another report.':'The report is unavailable. Review scope.md or regenerate if Recon is still available.'}</p>;}
export default function ReconSummaryButton({programId,assetId}:{programId:string;assetId?:string}){
  const[open,setOpen]=useState(false),[summary,setSummary]=useState<Summary|null>(null),[stale,setStale]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const url=`/api/programs/${programId}/${assetId?`assets/${assetId}/`:''}summary`;
  const request=useCallback(async(method='GET',regenerate=false)=>{const r=await fetch(url,{method,cache:'no-store',...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({regenerate})}:{})});const j=await r.json().catch(()=>null);if(!r.ok||!j)throw new SummaryRequestError(r.status===401?'Your session has expired. Sign in and try again.':r.status===403?'You do not have permission to view this report.':unavailable);setSummary(j.summary);setStale(j.stale);setError('');return j.summary as Summary|null;},[url]);
  const generate=async(regenerate:boolean)=>{setBusy(true);setError('');try{await request('POST',regenerate);}catch(e){setError(requestError(e));}finally{setBusy(false);}};
  const show=async()=>{setOpen(true);setBusy(true);setError('');try{const row=await request();if(!row)await request('POST');}catch(e){setError(requestError(e));}finally{setBusy(false);}};
  const waiting=summary&&['PENDING','RUNNING'].includes(summary.status);
  useEffect(()=>{if(!open||!waiting)return;const timer=setInterval(()=>{void request().catch(e=>setError(requestError(e)));},2000);return()=>clearInterval(timer);},[open,waiting,request]);
  const payload=summary?.content;
  const reportV3=payload&&'version' in payload&&payload.version===3?payload as ReconReportV3:null;
  const report=payload&&!reportV3&&'assessmentOverview' in payload?payload as ReconReport:null;
  const content=payload&&!reportV3&&!report?payload as ReconSummaryContent:null;
  return <>
    <Button size="sm" variant="secondary" onClick={()=>void show()}>Summary</Button>
    {open&&<Dialog title={report||reportV3?'Reconnaissance & Attack Surface Assessment':'Recon Summary'} onClose={()=>setOpen(false)}>
      <div className="space-y-5">
        {error&&<p role="alert" className="text-danger">{error}</p>}
        {busy&&<p role="status">Loading…</p>}
        {waiting&&<p role="status">{summary.status==='PENDING'?'Queued for the summary worker…':'Generating summary…'}</p>}
        {stale&&<p role="status">Recon data, scope or report format has changed. This stored report remains unchanged until regenerated. Verify current authorization before Research.</p>}
        {summary&&<p className="text-xs text-muted">{reportV3?'Recon evidence with a separate AI synthesis':'LLM-generated'} · {summary.model} · {summary.promptVersion} · {summary.generatedAt?new Date(summary.generatedAt).toLocaleString():waiting?'In progress':'Not generated'}<br/>Recon: {summary.scanRunId??summary.targetReconRunId}{summary.sourceFingerprint&&<><br/>Source fingerprint: {summary.sourceFingerprint.slice(0,16)}</>}</p>}
        {reportV3&&<ReconReportV3Content report={reportV3}/>}
        {report&&<ReconReportContent report={report}/>}
        {content&&<><section><h3 className="font-semibold">Overview</h3><p className="whitespace-pre-wrap break-words">{content.executiveSummary}</p></section>{content.sections.filter(s=>s.items.length).map((s,i)=><section key={i}><h3 className="font-semibold">{s.title}</h3><ul className="list-inside list-disc space-y-2">{s.items.map((item,j)=><li key={j} className="break-words">{item.text}<details className="ml-4 text-xs text-muted"><summary>Evidence</summary>{item.evidenceRefs.join(', ')}</details></li>)}</ul></section>)}<section><h3 className="font-semibold">Suggested research priorities</h3><ol className="list-inside list-decimal space-y-2">{content.researchPriorities.map((p,i)=><li key={i}>{p.text}<p className="text-xs text-muted">Evidence: {p.evidenceRefs.join(', ')}</p></li>)}</ol></section><section><h3 className="font-semibold">Limitations</h3><ul className="list-inside list-disc">{content.limitations.map((l,i)=><li key={i}>{l}</li>)}</ul></section><p className="text-xs text-muted">AI interpretation; verify against scope.md and original evidence. A research priority is not a confirmed vulnerability.</p></>}
        {report&&<p className="text-xs text-muted">AI-generated reconnaissance narrative. Verify evidence and scope before manual investigation; this is not a vulnerability assessment or a Finding.</p>}
        {!reportV3&&!waiting&&summary&&(summary.error||['FAILED','CANCELLED'].includes(summary.status))&&<ReconSummaryUnavailable sourceUnavailable={/^(?:SOURCE_REVOKED|SOURCE_UNAVAILABLE|DATA_UNAVAILABLE):/.test(summary.error??'')}/>}
        <Button variant="secondary" size="sm" disabled={busy||Boolean(waiting)} onClick={()=>void generate(true)}>{summary?'Regenerate':'Generate'}</Button>
      </div>
    </Dialog>}
  </>;
}
