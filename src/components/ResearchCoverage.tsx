'use client';
import {useEffect,useState} from 'react';
import {COVERAGE_STATES,type CoverageView,type CoverageEntry,type CoverageEventView} from '@/lib/research/coverage';
import {Button} from './ui/Button';
import {Dialog} from './ui/Dialog';
const label=(s:string)=>s.toLowerCase().replaceAll('_',' ');
const inputClass='block w-full rounded border border-border bg-surface p-2 text-sm';
async function request(url:string,body?:unknown){const response=await fetch(url,{cache:'no-store',...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw new Error(result.error??'Coverage unavailable');return result;}
function History({entry,url}:{entry:CoverageEntry;url:string}){
 const [events,setEvents]=useState<CoverageEventView[]>(entry.events),[more,setMore]=useState(true),[error,setError]=useState('');
 const load=async()=>{try{const batch:CoverageEventView[]=await request(url+'/history?coverageId='+encodeURIComponent(entry.id)+(events.length?'&before='+events.at(-1)!.revision:''));setEvents(old=>[...old,...batch]);setMore(batch.length===50);setError('');}catch(e){setError(e instanceof Error?e.message:'History unavailable');}};
 return <details className="text-sm"><summary>{entry.method==='UNSPECIFIED'?'Method not captured':entry.method} {entry.surface} · {entry.testKey} · {entry.contextLabel}{entry.comparisonLabel?' → '+entry.comparisonLabel:''} · {label(entry.state)}</summary>
 <p className="text-xs text-muted">Recon context: {entry.contextRunId}. Each context and method is distinct.</p>
 {events.map(e=><article key={e.id} className="my-2 border-l-2 border-border pl-3"><p>{label(e.state)} · {new Date(e.performedAt).toLocaleString()} · revision {e.revision}</p><p className="whitespace-pre-wrap break-words">Test: {e.action}</p><p className="whitespace-pre-wrap break-words">Result: {e.result}</p><p className="text-xs text-muted">{e.source} · Session {e.sessionReferenceId}{e.hypothesisReferenceId?' · Hypothesis '+e.hypothesisReferenceId:''}{e.hypothesisTestId?' · Test '+e.hypothesisTestId:''}{e.findingReferenceId?' · Finding '+e.findingReferenceId:''}</p><ul>{e.evidence.map((v,i)=><li key={i} className="break-all">{v.ref} — {v.summary}</li>)}</ul></article>)}
 {more&&entry.revision>events.length&&<Button size="sm" variant="secondary" onClick={()=>void load()}>Earlier test results</Button>}{error&&<p role="alert">{error}</p>}
 </details>;
}
function RecordTest({view,objective,url,onSaved}:{view:CoverageView;objective:CoverageView['objectives'][number];url:string;onSaved:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);setBusy(true);setError('');
  const testKey=String(data.get('testKey')),surface=String(data.get('surface')),method=String(data.get('method')),contextKey=String(data.get('context')),comparisonKey=String(data.get('comparison'))||null;
  const current=view.entries.find(e=>e.testKey===testKey&&e.objectiveKey===objective.stableKey&&e.contextRunId===view.contextRunId&&e.surface===surface&&e.method===method&&e.contextKey===contextKey&&e.comparisonKey===comparisonKey);
  try{await request(url,{eventKey:crypto.randomUUID(),sessionId:view.sessionId,planItemId:objective.id,testKey,surface,method,contextKey,comparisonKey,state:data.get('state'),expectedRevision:current?.revision??0,action:data.get('action'),result:data.get('result'),evidence:String(data.get('ref')).trim()?[{ref:String(data.get('ref')).trim(),summary:String(data.get('summary')).trim()||'Recorded test evidence'}]:[],performedAt:new Date().toISOString(),hypothesisId:String(data.get('hypothesis'))||null,hypothesisTestId:String(data.get('test'))||null,findingId:String(data.get('finding'))||null});form.reset();await onSaved();}
  catch(e){setError(e instanceof Error?e.message:'Test could not be recorded');}finally{setBusy(false);}
 }
 return <details><summary className="text-sm">Record structured test or status</summary><form className="mt-3 space-y-2" onSubmit={e=>void submit(e)}>
 <label className="block text-sm">Test identity (stable slug)<input name="testKey" required defaultValue="access-check" maxLength={80} pattern="[a-z0-9][a-z0-9_.-]*" className={inputClass}/></label><label className="block text-sm">Observed surface<select aria-label="Observed surface" name="surface" required className={inputClass}>{objective.surfaces.map((s,i)=><option key={i}>{s.url}</option>)}</select></label>
 <div className="grid gap-2 sm:grid-cols-3"><label>Method / action<select aria-label="Method / action" name="method" className={inputClass} defaultValue="UNSPECIFIED">{['UNSPECIFIED','GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','TRACE','CONNECT','ACTION'].map(m=><option key={m}>{m}</option>)}</select></label>
 <label>Authentication context<select aria-label="Authentication context" name="context" className={inputClass}>{objective.contexts.map(c=><option key={c.contextKey} value={c.contextKey}>{c.label}</option>)}</select></label>
 <label>Compared context<select aria-label="Compared context" name="comparison" className={inputClass}><option value="">No comparison</option>{objective.contexts.map(c=><option key={c.contextKey} value={c.contextKey}>{c.label}</option>)}</select></label></div>
 <p className="text-xs text-muted">Context selection describes your recorded test, not verified account identity. Do not repeat a recorded test without a reason. Unrecorded methods remain untested.</p>
 <label>State<select aria-label="State" name="state" className={inputClass}>{COVERAGE_STATES.map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label>
 <label>Action / test performed<textarea name="action" required maxLength={2000} className={inputClass}/></label>
 <label>Result / reason<textarea name="result" required maxLength={2000} className={inputClass}/></label>
 <label>Evidence artifact (relative workspace path)<input name="ref" maxLength={500} className={inputClass} placeholder="requests/orders-control.json"/></label>
 <label>Evidence summary<input name="summary" maxLength={2000} className={inputClass}/></label>
 <details><summary className="text-sm">Link existing hypothesis, test or Finding</summary><label>Hypothesis ID<input name="hypothesis" className={inputClass}/></label><label>Hypothesis test ID<input name="test" placeholder="T-001" className={inputClass}/></label><label>Finding ID<input name="finding" className={inputClass}/></label></details>
 <p className="text-xs text-muted">Completed tests need an existing evidence artifact. Keep passwords, cookies, tokens and personal data out of summaries. Recording coverage never creates a Finding.</p>
 {error&&<p role="alert">{error}</p>}<Button type="submit" disabled={busy||!view.sessionId||!objective.surfaces.length} size="sm">{busy?'Saving…':'Record test'}</Button>
 </form></details>;
}
export default function ResearchCoverage({targetId,compact=false}:{targetId:string;compact?:boolean}){
 const url='/api/research-coverage/'+encodeURIComponent(targetId),[open,setOpen]=useState(false),[view,setView]=useState<CoverageView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{setView(await request(url));};
 useEffect(()=>{if(compact)return;const controller=new AbortController();void fetch(url,{cache:'no-store',signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('Coverage unavailable');return response.json();}).then(data=>{if(!controller.signal.aborted)setView(data);}).catch(()=>{});return()=>controller.abort();},[compact,url]);
 const show=async()=>{setOpen(true);setBusy(true);setError('');try{await load();}catch(e){setError(e instanceof Error?e.message:'Coverage unavailable');}finally{setBusy(false);}};
 const operation=async(kind:'sync'|'context')=>{setBusy(true);setError('');try{await request(url+'/'+kind,kind==='sync'?{sessionId:view?.sessionId}:{});await load();setNotice(kind==='sync'?'Structured events imported. Update agent context before starting another test.':'Agent context updated. Read research/coverage-current.json in Codex or Claude.');}catch(e){setError(e instanceof Error?e.message:'Coverage operation failed');}finally{setBusy(false);}};
 return <><section aria-label="Research Coverage" className={compact?'flex flex-wrap items-center gap-2':'flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-3 py-1 text-sm'}><strong>Research Coverage</strong>{view&&<span className="text-xs text-muted">{view.counts.COVERED_NO_ISSUE_OBSERVED} covered · {view.counts.IN_PROGRESS} in progress · {view.counts.NOT_TESTED} untested · {view.counts.NEEDS_RETEST} needs retest</span>}<Button size="sm" variant="secondary" onClick={()=>void show()}>View coverage</Button></section>
 {open&&<Dialog title="Research Coverage" onClose={()=>setOpen(false)}><div className="space-y-4">{busy&&<p role="status">Loading…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {view&&<><p className="text-sm">{view.notice}</p><p className="text-xs text-muted">Coverage is persistent Target memory. Plan {view.planId??'not available'}{view.sessionId?' · Session '+view.sessionId:' · Open a Research console before recording tests.'}</p>{view.truncated&&<p role="status">Bounded view: review retained history before repeating a test.</p>}
 <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy||!view.sessionId} onClick={()=>void operation('sync')}>Import structured tests</Button><Button size="sm" variant="secondary" disabled={busy||!view.sessionId} onClick={()=>void operation('context')}>Update agent context</Button></div>
 <p className="text-xs text-muted">Agent input: findings/coverage-events.json (persistent console), research/coverage-events.json (ZIP workspace). Only explicit imports are used; terminal text is never coverage.</p>
 {!view.objectives.length&&<p>No captured objectives yet. Review Recon and the Research Plan.</p>}
 {view.objectives.map(o=><details key={o.id} className="rounded border border-border p-3"><summary>{o.title} · {o.untested?'untested':'recorded tests; other dimensions remain unknown'}</summary><div className="space-y-3 pt-3">{view.entries.filter(e=>e.objectiveKey===o.stableKey).map(e=><History key={e.id+':'+e.revision} entry={e} url={url}/>)}<RecordTest view={view} objective={o} url={url} onSaved={async()=>{await load();setNotice('Test saved. Update agent context before the next investigation.');}}/></div></details>)}
 {view.entries.some(e=>!view.objectives.some(o=>o.stableKey===e.objectiveKey))&&<details><summary>Historical objectives</summary>{view.entries.filter(e=>!view.objectives.some(o=>o.stableKey===e.objectiveKey)).map(e=><History key={e.id+':'+e.revision} entry={e} url={url}/>)}</details>}
 </>}
 </div></Dialog>}</>;
}
