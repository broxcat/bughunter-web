'use client';
import CurrentTargetScope from './CurrentTargetScope';
import CollectionPager from './CollectionPager';
import {paginationInput} from '@/lib/pagination';
import {useRouter,useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {Suspense,useCallback,useEffect,useState} from 'react';
import type {ProgramData} from '@/lib/targetFormData';
import {ASSET_FORMATS,ASSET_TYPES,ASSET_VALUES,assetTypeLabel,assetValueLabel,detectScopeAsset,type AssetType,type AssetValue} from '@/lib/scopeAssets';
import {Button} from './ui/Button';
import ScopeAssetActions,{ScopeAssetActionDialog,type ManagedScopeAsset,type ScopeActionResult} from './ScopeAssetActions';
type Asset=ManagedScopeAsset&{formatSource:string;reconStatus:string;scanRuns:{id:string;_count:{artifacts:number}}[]};
const format=(value:string)=>({URL:'URL',WILDCARD_DOMAIN:'Wildcard',SUBDOMAIN:'Subdomain',DOMAIN:'Domain',HOSTNAME:'Hostname',IP:'IP',CIDR:'CIDR'}[value]??value);
const label=(v:string)=>v.toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export default function ScopeAssetInventory(props:{program:Pick<ProgramData,'id'|'deletingAt'|'outOfScope'>}){return <Suspense fallback={<p role="status">Loading scope…</p>}><ScopeAssetCollection {...props}/></Suspense>;}
function ScopeAssetCollection({program}:{program:Pick<ProgramData,'id'|'deletingAt'|'outOfScope'>}) {
  const router=useRouter(),params=useSearchParams(),query=params.toString(),input=paginationInput(new URLSearchParams({page:params.get('assetPage')??'1',pageSize:params.get('pageSize')??'25'}),false);
  const [pages,setPages]=useState<{page:number;pages:number;total:number}|null>(null);
  const [assets,setAssets]=useState<Asset[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [notice,setNotice]=useState<ScopeActionResult|null>(null);
  const [formatChange,setFormatChange]=useState<{asset:Asset;format:string}|null>(null);
  const [adding,setAdding]=useState(false),[value,setValue]=useState(''),[type,setType]=useState<AssetType|''>(''),[importance,setImportance]=useState<AssetValue>('MEDIUM');
  const path='/scopes';
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch(`/api/programs/${program.id}/assets?page=${input.page}&pageSize=${input.pageSize}&active=1`,{cache:'no-store',signal});
    if(!response.ok)throw new Error('Unable to load scope assets');const assets=await response.json();if(signal?.aborted)return;
    const q=new URLSearchParams(query);if(q.has('assetPage')&&q.get('assetPage')!==String(assets.page)){q.set('assetPage',String(assets.page));router.replace(path+'?'+q);return;}
    setAssets(assets.items);setPages(assets);setError('');
  },[program.id,input.page,input.pageSize,query,router,path]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return refresh(controller.signal); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [refresh]);
  const act=async(url:string,method:string,body:unknown)=>{setBusy(true);setError('');setNotice(null);try{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error((await r.json()).error??'Action unavailable');await refresh();setNotice({message:'Changes saved.'});return true;}catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}};
  const changed=async(result:ScopeActionResult)=>{setNotice(result);try{await refresh();}catch(e){setError((e as Error).message);}};
  let preview:ReturnType<typeof detectScopeAsset>|undefined;try{preview=detectScopeAsset(value);}catch{}
  return <div className="space-y-6">
    {notice&&<p role="status">{notice.message}{notice.replacementId&&<Link className="ml-2 text-brand underline" href={'/scopes/'+notice.replacementId}>Open replacement</Link>}</p>}
    {error&&<p role="alert">{error}</p>}
      <section className="space-y-4"><div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto text-lg font-semibold">In scope</h2><Button size="sm" disabled={busy||!!program.deletingAt} onClick={()=>setAdding(!adding)}>{adding?'Cancel':'Add asset'}</Button></div>
        {adding&&<form className="scope-add grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void act(`/api/programs/${program.id}/assets`,'POST',{value,...(type?{type}:{}),assetValue:importance}).then(ok=>{if(ok){setAdding(false);setValue('');setType('');}});}}>
          <label className="block text-sm sm:col-span-2">Asset<input autoFocus className="mt-1 block w-full" value={value} onChange={e=>setValue(e.target.value)} placeholder="*.example.com or https://example.com/app" required maxLength={2048}/>{preview&&<span className="text-xs text-muted">{format(preview.format)} · {assetTypeLabel[preview.inferredType]}</span>}</label>
          <details className="ui-disclosure sm:col-span-2"><summary>Advanced</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Type<select aria-label="New asset type" className="mt-1 block w-full" value={type} onChange={e=>setType(e.target.value as AssetType|'')}><option value="">Suggested</option>{ASSET_TYPES.map(t=><option key={t} value={t}>{assetTypeLabel[t]}</option>)}</select></label><label className="text-sm">Asset value<select aria-label="New asset value" className="mt-1 block w-full" value={importance} onChange={e=>setImportance(e.target.value as AssetValue)}>{ASSET_VALUES.map(v=><option key={v} value={v}>{assetValueLabel[v]}</option>)}</select></label></div></details><div><Button size="sm" type="submit" disabled={busy||!preview}>Save asset</Button></div>
        </form>}
        {assets.length>0&&<div className="ui-table-scroll" tabIndex={0} role="region" aria-label="Scope assets table"><table className="ui-inventory w-full text-left text-sm"><caption className="sr-only">Authorized scope assets</caption><thead><tr>{['Asset','Format / type','Status','Actions'].map(n=><th scope="col" key={n}>{n}</th>)}</tr></thead><tbody>{assets.map(a=><tr key={a.id}>
          <td data-label="Asset"><Link className="break-all font-medium text-brand" href={`/scopes/${a.id}`}>{a.normalizedValue}</Link></td>
          <td data-label="Format / type"><div><span>{format(a.format)}</span><p className="text-xs text-muted">{assetTypeLabel[a.type]}</p></div></td><td data-label="Status">Active</td>
          <td data-label="Actions"><details><summary>Actions</summary><ScopeAssetActions asset={a} programId={program.id} onChanged={changed}/><details className="mt-3"><summary>Advanced</summary><div className="mt-2 space-y-2"><label className="block">Format<select aria-label={`Format ${a.normalizedValue}`} value={a.format} disabled={busy} className="block w-full" onChange={e=>setFormatChange({asset:a,format:e.target.value})}>{ASSET_FORMATS.map(f=><option key={f} value={f}>{format(f)}</option>)}</select></label>{a.formatSource==='MANUAL'&&<button className="text-xs text-muted underline" onClick={()=>setFormatChange({asset:a,format:'AUTO'})}>Reset to detected</button>}<label className="block">Type<select aria-label={`Type ${a.normalizedValue}`} value={a.type} disabled={busy} className="block w-full" onChange={e=>void act(`/api/programs/${program.id}/assets/${a.id}`,'PATCH',{type:e.target.value,expectedUpdatedAt:a.updatedAt})}>{ASSET_TYPES.map(t=><option key={t} value={t}>{assetTypeLabel[t]}</option>)}</select></label><label className="block">Asset value<select aria-label={`Value ${a.normalizedValue}`} value={a.assetValue} disabled={busy} className="block w-full" onChange={e=>void act(`/api/programs/${program.id}/assets/${a.id}`,'PATCH',{assetValue:e.target.value,expectedUpdatedAt:a.updatedAt})}>{ASSET_VALUES.map(v=><option key={v} value={v}>{assetValueLabel[v]}</option>)}</select></label><p className="text-xs text-muted">Recon: {label(a.reconStatus)} · {a.scanRuns[0]?._count.artifacts??0} observations</p></div></details></details></td>
        </tr>)}</tbody></table></div>}
        {!pages&&!error&&<p role="status" className="text-sm text-muted">Loading scope assets…</p>}{pages&&!assets.length&&<p className="text-sm text-muted">No assets yet. Add an explicitly authorized asset to begin.</p>}
        {pages&&<CollectionPager path={path} query={query} {...pages} pageKey="assetPage" label="Scope management pages" noun="active assets"/>}
      </section>
      <section className="space-y-3 border-t border-border pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Out of scope</h2><Link className="text-sm text-muted underline" href={`/targets/${program.id}/settings#out-of-scope`}>Edit exclusions</Link></div>{program.outOfScope.length?<ul className="space-y-1 text-sm">{program.outOfScope.map(host=><li className="break-all" key={host}>{host}</li>)}</ul>:<p className="text-sm text-muted">No exclusions recorded.</p>}</section>
      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4"><CurrentTargetScope programId={program.id}/><Link className="text-sm text-muted underline" href={`/scopes?inventory=1&target=${program.id}`}>All assets and history</Link></div>
    {formatChange&&<ScopeAssetActionDialog asset={formatChange.asset} programId={program.id} mode="replace" initialFormat={formatChange.format} onClose={()=>setFormatChange(null)} onChanged={changed}/>}
  </div>;
}
