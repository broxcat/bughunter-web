'use client';
import CurrentTargetScope from './CurrentTargetScope';
import CollectionPager from './CollectionPager';
import {paginationInput} from '@/lib/pagination';
import {useRouter,useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {Suspense,useCallback,useEffect,useState} from 'react';
import type {ProgramData} from './ProgramForm';
import {ASSET_FORMATS,ASSET_TYPES,ASSET_VALUES,assetTypeLabel,assetValueLabel,detectScopeAsset,type AssetType,type AssetValue} from '@/lib/scopeAssets';
import {Button} from './ui/Button';
import ScopeAssetActions,{ScopeAssetActionDialog,type ManagedScopeAsset,type ScopeActionResult} from './ScopeAssetActions';
type Asset=ManagedScopeAsset&{formatSource:string;reconStatus:string;scanRuns:{id:string;_count:{artifacts:number}}[]};
type ReconState={latest:{id:string;status:string;outcome:string|null}|null;needsRecon:boolean;researchReady:boolean;findingsConfirmed:number;researchStarted:number};
const format=(value:string)=>({URL:'URL',WILDCARD_DOMAIN:'Wildcard',SUBDOMAIN:'Subdomain',DOMAIN:'Domain',HOSTNAME:'Hostname',IP:'IP',CIDR:'CIDR'}[value]??value);
const label=(v:string)=>v.toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export default function ProgramWorkflow(props:{program:ProgramData;view?:'home'|'scope'}){return <Suspense fallback={<p role="status">Loading Scope…</p>}><WorkflowCollection {...props}/></Suspense>;}
function WorkflowCollection({program,view='home'}:{program:ProgramData;view?:'home'|'scope'}) {
  const router=useRouter(),params=useSearchParams(),query=params.toString(),input=paginationInput(new URLSearchParams({page:params.get('assetPage')??'1',pageSize:params.get('pageSize')??'25'}),false);
  const [pages,setPages]=useState<{page:number;pages:number;total:number}|null>(null);
  const [assets,setAssets]=useState<Asset[]>([]),[state,setState]=useState<ReconState>({latest:null,needsRecon:true,researchReady:false,findingsConfirmed:0,researchStarted:0}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [notice,setNotice]=useState<ScopeActionResult|null>(null);
  const [formatChange,setFormatChange]=useState<{asset:Asset;format:string}|null>(null);
  const [adding,setAdding]=useState(false),[value,setValue]=useState(''),[type,setType]=useState<AssetType|''>(''),[importance,setImportance]=useState<AssetValue>('MEDIUM');
  const path=view==='scope'?'/scopes':'/targets/'+program.id;
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    const [a,b]=await Promise.all([fetch(`/api/programs/${program.id}/assets?page=${input.page}&pageSize=${input.pageSize}&active=1`,{cache:'no-store',signal}),fetch(`/api/programs/${program.id}/recon`,{cache:'no-store',signal})]);
    if(!a.ok||!b.ok)throw new Error('Unable to load Target workflow');const [assets,state]=await Promise.all([a.json(),b.json()]);if(signal?.aborted)return;
    const q=new URLSearchParams(query);if(q.has('assetPage')&&q.get('assetPage')!==String(assets.page)){q.set('assetPage',String(assets.page));router.replace(path+'?'+q);return;}
    setAssets(assets.items);setPages(assets);setState(state);setError('');
  },[program.id,input.page,input.pageSize,query,router,path]);
  useEffect(()=>{const controller=new AbortController();const load=()=>{if(!controller.signal.aborted)void refresh(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message);});};load();const timer=setInterval(load,5000);return()=>{controller.abort();clearInterval(timer);};},[refresh]);
  const act=async(url:string,method:string,body:unknown)=>{setBusy(true);setError('');setNotice(null);try{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error((await r.json()).error??'Action unavailable');await refresh();setNotice({message:'Changes saved.'});return true;}catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}};
  const changed=async(result:ScopeActionResult)=>{setNotice(result);try{await refresh();}catch(e){setError((e as Error).message);}};
  const recon=state.latest?label(state.latest.outcome??state.latest.status):'Not run';
  let preview:ReturnType<typeof detectScopeAsset>|undefined;try{preview=detectScopeAsset(value);}catch{}
  return <div className="space-y-6">
    <nav aria-label="Target workflow"><ol className="target-workflow border-y border-border py-3">{[
      ['Scope',pages?`${pages.total} assets`:'',`/scopes?target=${program.id}`],['Recon',recon,`/recon?program=${program.id}`],['Research',state.researchStarted?'Started':state.researchReady?'Ready':'Pending',`/research?program=${program.id}`],['Findings',String(state.findingsConfirmed??0),`/targets/${program.id}/findings`],['Report','',`/targets/${program.id}/report`],
    ].map(([name,status,href])=><li key={name}><Link aria-current={view==='scope'&&name==='Scope'?'page':undefined} className="block font-medium" href={href}>{name}</Link><p className="text-xs text-muted">{status}</p></li>)}</ol></nav>
    {notice&&<p role="status">{notice.message}{notice.replacementId&&<Link className="ml-2 text-brand underline" href={'/scopes/'+notice.replacementId}>Open replacement</Link>}</p>}
    {error&&<p role="alert">{error}</p>}
    {view==='home'&&<section className="space-y-3 py-3"><h2 className="font-semibold">{pages?.total?'Continue your work':'Add Scope to begin'}</h2><p className="text-sm text-muted">{pages?.total?'Review authorized assets and the latest Recon before opening Research.':'Add the assets you are authorized to test, then review any exclusions.'}</p><Link className="ui-btn" data-variant="primary" href={pages?.total?`/recon?program=${program.id}`:`/scopes?target=${program.id}`}>{pages?.total?'Open Recon':'Add Scope'}</Link>{state.latest&&<Link className="ml-4 text-sm text-muted underline" href={`/recon/runs/${state.latest.id}`}>Latest Recon run</Link>}</section>}
    {view==='scope'&&<>
      <section className="space-y-4"><div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto text-lg font-semibold">In scope</h2><Button size="sm" disabled={busy||!!program.deletingAt} onClick={()=>setAdding(!adding)}>{adding?'Cancel':'Add asset'}</Button></div>
        {adding&&<form className="scope-add grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void act(`/api/programs/${program.id}/assets`,'POST',{value,...(type?{type}:{}),assetValue:importance}).then(ok=>{if(ok){setAdding(false);setValue('');setType('');}});}}>
          <label className="block text-sm sm:col-span-2">Asset<input autoFocus className="mt-1 block w-full" value={value} onChange={e=>setValue(e.target.value)} placeholder="*.example.com or https://example.com/app" required maxLength={2048}/>{preview&&<span className="text-xs text-muted">{format(preview.format)} · {assetTypeLabel[preview.inferredType]}</span>}</label>
          <details className="ui-disclosure sm:col-span-2"><summary>Advanced</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Type<select aria-label="New asset type" className="mt-1 block w-full" value={type} onChange={e=>setType(e.target.value as AssetType|'')}><option value="">Suggested</option>{ASSET_TYPES.map(t=><option key={t} value={t}>{assetTypeLabel[t]}</option>)}</select></label><label className="text-sm">Asset value<select aria-label="New asset value" className="mt-1 block w-full" value={importance} onChange={e=>setImportance(e.target.value as AssetValue)}>{ASSET_VALUES.map(v=><option key={v} value={v}>{assetValueLabel[v]}</option>)}</select></label></div></details><div><Button size="sm" type="submit" disabled={busy||!preview}>Save asset</Button></div>
        </form>}
        {assets.length>0&&<div className="ui-table-scroll" tabIndex={0} role="region" aria-label="Scope Assets table"><table className="ui-inventory w-full text-left text-sm"><caption className="sr-only">Authorized Scope assets</caption><thead><tr>{['Asset','Format / type','Status','Actions'].map(n=><th scope="col" key={n}>{n}</th>)}</tr></thead><tbody>{assets.map(a=><tr key={a.id}>
          <td data-label="Asset"><Link className="break-all font-medium text-brand" href={`/scopes/${a.id}`}>{a.normalizedValue}</Link></td>
          <td data-label="Format / type"><div><span>{format(a.format)}</span><p className="text-xs text-muted">{assetTypeLabel[a.type]}</p></div></td><td data-label="Status">Active</td>
          <td data-label="Actions"><details><summary>Actions</summary><ScopeAssetActions asset={a} programId={program.id} onChanged={changed}/><details className="mt-3"><summary>Advanced</summary><div className="mt-2 space-y-2"><label className="block">Format<select aria-label={`Format ${a.normalizedValue}`} value={a.format} disabled={busy} className="block w-full" onChange={e=>setFormatChange({asset:a,format:e.target.value})}>{ASSET_FORMATS.map(f=><option key={f} value={f}>{format(f)}</option>)}</select></label>{a.formatSource==='MANUAL'&&<button className="text-xs text-muted underline" onClick={()=>setFormatChange({asset:a,format:'AUTO'})}>Reset to detected</button>}<label className="block">Type<select aria-label={`Type ${a.normalizedValue}`} value={a.type} disabled={busy} className="block w-full" onChange={e=>void act(`/api/programs/${program.id}/assets/${a.id}`,'PATCH',{type:e.target.value,expectedUpdatedAt:a.updatedAt})}>{ASSET_TYPES.map(t=><option key={t} value={t}>{assetTypeLabel[t]}</option>)}</select></label><label className="block">Asset value<select aria-label={`Value ${a.normalizedValue}`} value={a.assetValue} disabled={busy} className="block w-full" onChange={e=>void act(`/api/programs/${program.id}/assets/${a.id}`,'PATCH',{assetValue:e.target.value,expectedUpdatedAt:a.updatedAt})}>{ASSET_VALUES.map(v=><option key={v} value={v}>{assetValueLabel[v]}</option>)}</select></label><p className="text-xs text-muted">Recon: {label(a.reconStatus)} · {a.scanRuns[0]?._count.artifacts??0} observations</p></div></details></details></td>
        </tr>)}</tbody></table></div>}
        {!pages&&!error&&<p role="status" className="text-sm text-muted">Loading Scope Assets…</p>}{pages&&!assets.length&&<p className="text-sm text-muted">No assets yet. Add an explicitly authorized asset to begin.</p>}
        {pages&&<CollectionPager path={path} query={query} {...pages} pageKey="assetPage" label="Scope management pages" noun="active assets"/>}
      </section>
      <section className="space-y-3 border-t border-border pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Out of scope</h2><Link className="text-sm text-muted underline" href={`/targets/${program.id}/settings#out-of-scope`}>Edit exclusions</Link></div>{program.outOfScope.length?<ul className="space-y-1 text-sm">{program.outOfScope.map(host=><li className="break-all" key={host}>{host}</li>)}</ul>:<p className="text-sm text-muted">No exclusions recorded.</p>}</section>
      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4"><CurrentTargetScope programId={program.id}/><Link className="text-sm text-muted underline" href={`/scopes?inventory=1&target=${program.id}`}>All assets and history</Link></div>
    </>}
    {formatChange&&<ScopeAssetActionDialog asset={formatChange.asset} programId={program.id} mode="replace" initialFormat={formatChange.format} onClose={()=>setFormatChange(null)} onChanged={changed}/>}
  </div>;
}
