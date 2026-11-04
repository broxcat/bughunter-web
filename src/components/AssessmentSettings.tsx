'use client';
import { useEffect,useState } from 'react';
import { assessmentModes,assessmentSourceKinds,assessmentModeLabel,assessmentSourceKindLabel } from '@/lib/assessment';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

type Mode=(typeof assessmentModes)[number];
type Kind=(typeof assessmentSourceKinds)[number];
type Source={id:string;label:string;kind:Kind;locator:string;reference:string|null;includePaths:string[];excludePaths:string[];active:boolean;notes:string|null;effective:boolean};
type Draft=Omit<Source,'id'|'effective'>;
const field='w-full rounded border border-border bg-surface p-2';
const emptyDraft=():Draft=>({label:'',kind:'GIT_REPOSITORY',locator:'',reference:null,includePaths:[],excludePaths:[],active:true,notes:null});
const lines=(value:string)=>value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);

export default function AssessmentSettings({programId,mode,onModeSaved}:{programId:string;mode:Mode;onModeSaved:(mode:Mode)=>void}){
  const[sources,setSources]=useState<Source[]>([]),[pendingMode,setPendingMode]=useState<Mode|null>(null),[draft,setDraft]=useState<Draft|null>(null),[editing,setEditing]=useState<string|null>(null),[included,setIncluded]=useState(''),[excluded,setExcluded]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const url='/api/programs/'+programId+'/assessment-sources';
  useEffect(()=>{let alive=true;void fetch(url,{cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('Unable to load authorized sources.');const data=await response.json();if(alive)setSources(data.sources);}).catch(()=>{if(alive)setError('Unable to load authorized sources.');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[url,mode]);
  async function confirmMode(){
    if(!pendingMode)return;setBusy(true);setError('');
    try{const response=await fetch('/api/programs/'+programId+'/assessment',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({assessmentMode:pendingMode,confirmed:true})});if(!response.ok)throw new Error();const data=await response.json();onModeSaved(data.assessmentMode);setSources(previous=>previous.map(source=>({...source,effective:data.assessmentMode==='WHITE_BOX'&&source.active})));setDraft(null);setEditing(null);setPendingMode(null);}
    catch{setError('Unable to change assessment mode. Review your access and try again.');}finally{setBusy(false);}
  }
  async function saveSource(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!draft)return;setBusy(true);setError('');
    try{const response=await fetch(editing?url+'/'+editing:url,{method:editing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,includePaths:lines(included),excludePaths:lines(excluded)})});if(!response.ok)throw new Error();const {source}=await response.json();setSources(previous=>editing?previous.map(row=>row.id===source.id?source:row):[...previous,source]);setDraft(null);setEditing(null);}
    catch{setError('Unable to save this authorized source. Check its fields and your access.');}finally{setBusy(false);}
  }
  async function mutateSource(source:Source,remove=false){
    if(remove&&!window.confirm('Remove authorized source “'+source.label+'”? Historical references are preserved.'))return;
    setBusy(true);setError('');
    try{const response=await fetch(url+'/'+source.id,{method:remove?'DELETE':'PATCH',...(remove?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!source.active})})});if(!response.ok)throw new Error();const updated=(await response.json()).source;setSources(previous=>previous.map(row=>row.id===updated.id?updated:row));}
    catch{setError('Unable to update this authorized source. Review your access and try again.');}finally{setBusy(false);}
  }
  return <section aria-labelledby="assessment-mode-heading" className="space-y-4 border-b border-border pb-6">
    <h2 id="assessment-mode-heading" className="text-lg font-semibold">Assessment mode</h2>
    <fieldset className="space-y-2" disabled={busy}><legend className="sr-only">Assessment mode</legend>{assessmentModes.map(value=><label key={value} className="mr-5 inline-flex items-center gap-2"><input type="radio" name="assessment-mode" checked={(pendingMode??mode)===value} onChange={()=>{if(value!==mode)setPendingMode(value);}}/>{assessmentModeLabel(value)}</label>)}</fieldset>
    <p className="text-sm text-muted">Black-box uses runtime observations. White-box may also use explicitly authorized source references. Neither mode expands the network scope.</p>
    {error&&<p role="alert" className="text-danger">{error}</p>}
    {loading&&<p role="status" className="text-sm text-muted">Loading authorized sources…</p>}
    {mode==='BLACK_BOX'&&sources.length>0&&<p role="status" className="text-sm text-muted">{sources.length} authorized source record{sources.length===1?' is':'s are'} retained and excluded from the effective assessment in black-box mode. Switch to white-box to manage them.</p>}
    {mode==='WHITE_BOX'&&<section aria-labelledby="authorized-sources-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3"><h3 id="authorized-sources-heading" className="font-semibold">Authorized sources</h3>{!draft&&<Button size="sm" variant="secondary" disabled={busy} onClick={()=>{setEditing(null);setIncluded('');setExcluded('');setError('');setDraft(emptyDraft());}}>Add source</Button>}</div>
      <p className="text-sm text-muted">Register only sources you are authorized to assess. These are metadata references; nothing is cloned, downloaded or ingested. Do not include credentials or tokens.</p>
      {!loading&&!sources.length&&!draft&&<p className="text-sm text-muted">No authorized sources registered.</p>}
      <ul className="divide-y divide-border">{sources.map(source=><li key={source.id} aria-label={'Authorized source '+source.label} className="space-y-2 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium break-words">{source.label} <span className="font-normal text-muted">· {assessmentSourceKindLabel(source.kind)}</span></p><span className="text-sm">{source.effective?'Active':'Inactive'}</span></div>
        <p className="break-all text-sm text-muted">{source.locator}{source.reference&&<> · {source.reference}</>}</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={busy||!!draft} onClick={()=>{setEditing(source.id);setIncluded(source.includePaths.join('\n'));setExcluded(source.excludePaths.join('\n'));setError('');setDraft({label:source.label,kind:source.kind,locator:source.locator,reference:source.reference,includePaths:source.includePaths,excludePaths:source.excludePaths,active:source.active,notes:source.notes});}}>Edit</Button><Button size="sm" variant="ghost" disabled={busy||!!draft} onClick={()=>void mutateSource(source)}>{source.active?'Deactivate':'Reactivate'}</Button><Button size="sm" variant="ghost" disabled={busy||!!draft} onClick={()=>void mutateSource(source,true)}>Remove</Button></div>
      </li>)}</ul>
      {draft&&<form aria-label={editing?'Edit authorized source':'New authorized source'} onSubmit={event=>void saveSource(event)} className="space-y-3 rounded border border-border p-4">
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Source label<input required maxLength={120} className={field} value={draft.label} onChange={event=>setDraft({...draft,label:event.target.value})}/></label><label className="block text-sm">Source kind<select aria-label="Source kind" className={field} value={draft.kind} onChange={event=>setDraft({...draft,kind:event.target.value as Kind})}>{assessmentSourceKinds.map(kind=><option key={kind} value={kind}>{assessmentSourceKindLabel(kind)}</option>)}</select></label></div>
        <label className="block text-sm">Locator<input required maxLength={2048} className={field} placeholder="Repository URL or authorized source reference" value={draft.locator} onChange={event=>setDraft({...draft,locator:event.target.value})}/></label>
        <label className="block text-sm">Reference <span className="text-muted">(optional branch, tag or version)</span><input maxLength={200} className={field} value={draft.reference??''} onChange={event=>setDraft({...draft,reference:event.target.value||null})}/></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Included paths <span className="text-muted">(one per line)</span><textarea rows={3} className={field} value={included} onChange={event=>setIncluded(event.target.value)}/></label><label className="block text-sm">Excluded paths <span className="text-muted">(one per line)</span><textarea rows={3} className={field} value={excluded} onChange={event=>setExcluded(event.target.value)}/></label></div>
        <label className="block text-sm">Notes <span className="text-muted">(optional)</span><textarea maxLength={2000} rows={2} className={field} value={draft.notes??''} onChange={event=>setDraft({...draft,notes:event.target.value||null})}/></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={event=>setDraft({...draft,active:event.target.checked})}/>Source enabled</label>
        <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>{busy?'Saving…':'Save source'}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setDraft(null);setEditing(null);}}>Cancel</Button></div>
      </form>}
    </section>}
    {pendingMode&&<Dialog title="Change assessment mode?" onClose={()=>{if(!busy)setPendingMode(null);}}><p>Switch to {assessmentModeLabel(pendingMode)}?</p><p className="my-3 text-sm text-muted">{pendingMode==='WHITE_BOX'?'Only explicitly authorized sources may supplement runtime evidence. This does not expand the network scope.':'Authorized source records will be retained and excluded from the effective assessment. Existing Recon and Research records remain unchanged.'}</p><div className="flex gap-2"><Button disabled={busy} onClick={()=>void confirmMode()}>Confirm mode change</Button><Button variant="secondary" disabled={busy} onClick={()=>setPendingMode(null)}>Cancel</Button></div></Dialog>}
  </section>;
}
