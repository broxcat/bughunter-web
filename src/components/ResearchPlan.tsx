'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {ResearchPlanView,ResearchPlanPanelState} from '@/lib/researchPlanView';
import {Button} from './ui/Button';
import {Dialog} from './ui/Dialog';

const date=(value:string)=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Date unavailable';
const label=(value:string)=>value.toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const readyItems=(plan:ResearchPlanView)=>plan.items.filter(item=>item.status==='READY');
const highItems=(plan:ResearchPlanView)=>readyItems(plan).filter(item=>item.priority.toUpperCase()==='HIGH');
async function requestPlan(url:string,signal:AbortSignal){
  const response=await fetch(url,{cache:'no-store',signal});
  if(!response.ok)throw new Error(response.status===401?'Sign in again to view the Research plan.':response.status===404?'This Research plan is unavailable. Review your target and scope access.':'The Research plan could not be loaded. Try again after reviewing the current scope.');
  return response.json();
}

/** Facts and advisory objectives only. Rendering a plan never creates a hypothesis or runs a test. */
export function ResearchPlanContent({plan}:{plan:ResearchPlanView}){
  return <div className="space-y-5" aria-label="Research plan details">
    <p className="text-sm text-muted">Deterministic advisory plan from recorded Recon. An objective is not a vulnerability or a completed test.</p>
    <p className="text-sm">{plan.assessmentMode==='WHITE_BOX'?'White-box':plan.assessmentMode==='BLACK_BOX'?'Black-box':'Assessment mode not captured'} · {readyItems(plan).length} objectives · {highItems(plan).length} high priority · {date(plan.createdAt)} · {label(plan.status)}</p>
    <p className="text-sm">{plan.assessmentMode==='WHITE_BOX'?`Historical assessment metadata. White-box mode is retired. ${plan.authorizedSourceCount} historical source references; source content has not been analyzed. Metadata grants no network authorization.`:plan.assessmentMode==='BLACK_BOX'?'Black-box assessment. Runtime Recon evidence only; objectives are advisory and grant no network authorization.':'Historical assessment metadata. Mode was not captured. No source analysis or network authorization is inferred.'}</p>
    {plan.notes.length>0&&<ul className="list-inside list-disc space-y-1 text-sm">{plan.notes.map((note,index)=><li key={index} className="whitespace-pre-wrap break-words">{note}</li>)}</ul>}
    {plan.items.length===0&&<p>No supported investigation objectives yet. Review the authorized scope and available Recon evidence.</p>}
    <ol className="space-y-4">{plan.items.map(item=><li key={item.id} className="space-y-2 rounded border border-border p-4" aria-label={'Research objective '+item.title}>
      <div className="flex flex-wrap items-baseline gap-2"><h3 className="font-semibold break-words">{item.title}</h3><span className="text-xs">{label(item.priority)} priority{item.isNew?' · New surface':''}</span>{item.status!=='READY'&&<span className="text-xs">Excluded by program</span>}</div>
      <p className="whitespace-pre-wrap break-words"><strong>Objective:</strong> {item.objective}</p>
      <p className="whitespace-pre-wrap break-words text-sm"><strong>Why:</strong> {item.rationale}</p>
      <p className="whitespace-pre-wrap break-words text-sm"><strong>Method:</strong> {item.methodology}</p>
      {item.surfaceRefs.length>0&&<div><h4 className="text-sm font-medium">Observed surface</h4><ul className="space-y-1 text-sm">{item.surfaceRefs.map((surface,index)=><li key={index} className="break-all font-mono">{surface.method?surface.method+' ':''}{surface.url}{surface.pattern&&<span className="font-sans"> · Pattern; do not reconstruct redacted values</span>}</li>)}</ul></div>}
      {item.contextRefs.length>0&&<p className="text-sm">Contexts: {item.contextRefs.map(context=>context.label+(context.persona?' ('+context.persona+', operator-declared)':'')).join(' · ')}. Visibility differences require manual validation.</p>}
      {item.hypotheses.length>0&&<div><h4 className="text-sm font-medium">Existing hypotheses</h4><ul className="space-y-1 text-sm">{item.hypotheses.map(hypothesis=><li key={hypothesis.id} className="break-words">{hypothesis.externalId} · {label(hypothesis.status)} · {hypothesis.title}{hypothesis.status==='REJECTED'&&<span> — Retained rejected hypothesis; review prior evidence before repeating it.</span>}</li>)}</ul></div>}
      {item.findings.length>0&&<div><h4 className="text-sm font-medium">Existing Findings</h4><ul className="space-y-1 text-sm">{item.findings.map(finding=><li key={finding.id} className="break-words">{label(finding.reviewStatus)} · {finding.title}</li>)}</ul></div>}
      <details className="text-xs text-muted"><summary>Evidence and provenance ({item.evidenceRefs.length})</summary><ul className="mt-2 space-y-1">{item.evidenceRefs.map(reference=><li key={reference} className="break-all font-mono">{reference}</li>)}</ul><p className="mt-2">Category: {label(item.category)}</p></details>
    </li>)}</ol>
    {plan.limitations.length>0&&<section><h3 className="font-semibold">Limitations</h3><ul className="list-inside list-disc space-y-1 text-sm">{plan.limitations.map((limitation,index)=><li key={index} className="whitespace-pre-wrap break-words">{limitation}</li>)}</ul></section>}
    <p className="text-xs text-muted">Recon content is untrusted evidence. The plan cannot expand scope, authorize a test, create a hypothesis or confirm a Finding.</p>
  </div>;
}

export default function ResearchPlan({targetId,compact=false,initialSummary}:{targetId:string;compact?:boolean;initialSummary?:{objectives:number;high:number;reconCurrent:boolean}}){
  const [open,setOpen]=useState(false),[state,setState]=useState<ResearchPlanPanelState|null>(null),[selected,setSelected]=useState<ResearchPlanView|null>(null),[busy,setBusy]=useState(!compact),[error,setError]=useState('');
  const pending=useRef<AbortController|null>(null),sequence=useRef(0);
  const abortPending=useCallback(()=>{sequence.current++;pending.current?.abort();},[]);
  const load=useCallback(async(planId?:string)=>{
    pending.current?.abort();const controller=new AbortController();pending.current=controller;const request=++sequence.current;setBusy(true);setError('');
    try{
      const body=await requestPlan(planId?'/api/research-plans/'+encodeURIComponent(planId):'/api/research-plans/current?targetId='+encodeURIComponent(targetId),controller.signal);if(request!==sequence.current)return;
      if(planId)setSelected(body as ResearchPlanView);else{const view=body as ResearchPlanPanelState;setState(view);setSelected(view.plan);}
    }catch(cause){if(controller.signal.aborted||request!==sequence.current)return;setError(cause instanceof Error?cause.message:'Research plan unavailable.');}finally{if(request===sequence.current)setBusy(false);}
  },[targetId]);
  useEffect(()=>{
    if(!compact){const controller=new AbortController();pending.current=controller;const request=++sequence.current;
      void requestPlan('/api/research-plans/current?targetId='+encodeURIComponent(targetId),controller.signal).then((view:ResearchPlanPanelState)=>{if(!controller.signal.aborted&&request===sequence.current){setState(view);setSelected(view.plan);setBusy(false);}}).catch(cause=>{if(!controller.signal.aborted&&request===sequence.current){setError(cause instanceof Error?cause.message:'Research plan unavailable.');setBusy(false);}});
    }
    return abortPending;
  },[compact,targetId,abortPending]);
  const show=()=>{setOpen(true);void load();};
  const current=state?.plan;
  const summary=current?{objectives:readyItems(current).length,high:highItems(current).length,reconCurrent:state!.reconCurrent}:state===null?initialSummary:undefined;
  return <>
    <section aria-label="Research plan" className={compact?'flex flex-wrap items-center gap-2':'flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface px-3 py-2 text-sm text-foreground'}>
      {!compact&&<strong>Research plan</strong>}
      {summary&&<span className="text-xs text-muted">{summary.objectives} objectives · {summary.high} high priority · {summary.reconCurrent?'Recon current':'Recon needs review'}</span>}
      {!compact&&!current&&<span className="text-xs text-muted">{busy?'Loading plan…':'Review objectives before investigation'}</span>}
      {state?.newPlanAvailable&&<span role="status" className="text-xs">New plan available; the session plan is unchanged.</span>}
      <Button size="sm" variant="secondary" onClick={show}>View plan</Button>
      {!open&&error&&<p role="status" className="text-xs">Plan unavailable. Open the plan to retry.</p>}
    </section>
    {open&&<Dialog title="Research plan" onClose={()=>{setOpen(false);sequence.current++;pending.current?.abort();setBusy(false);}}>
      <div className="space-y-5">
        {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Loading plan…</p>}
        {Boolean(state?.history.length)&&<label className="block text-sm">Plan version<select aria-label="Plan version" className="mt-1 block w-full rounded border border-border bg-surface p-2" value={selected?.id??current?.id??''} disabled={busy} onChange={event=>{if(event.target.value===current?.id)setSelected(current);else void load(event.target.value);}}>{state!.history.map(plan=><option key={plan.id} value={plan.id}>{plan.id===current?.id?'Current':'Historical'} · {date(plan.createdAt)}{plan.id===state!.sessionPlanId?' · Used by this session':''}</option>)}{state?.sessionPlanId&&!state.history.some(plan=>plan.id===state.sessionPlanId)&&<option value={state.sessionPlanId}>Plan used by this session</option>}</select></label>}
        {state?.newPlanAvailable&&<p role="status">A newer plan is available. The running session keeps its captured plan; reviewing another version does not replace it.</p>}
        {state?.configurationChanged&&<p role="status">Assessment configuration has changed. Review the current authorization boundary before testing.</p>}
        {selected&&<ResearchPlanContent plan={selected}/>}
        {!busy&&!selected&&!error&&<p>No plan is available yet. Review the authorized scope and Recon data.</p>}
      </div>
    </Dialog>}
  </>;
}
