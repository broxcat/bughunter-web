'use client';
import Link from 'next/link';
import {useState} from 'react';
import {createPortal} from 'react-dom';
import {ASSET_FORMATS,ASSET_TYPES,ASSET_VALUES,assetTypeLabel,assetValueLabel,detectScopeAsset,overrideAssetFormat,type AssetType,type AssetValue} from '@/lib/scopeAssets';
import {Button} from './ui/Button';
import {Dialog} from './ui/Dialog';
export type ManagedScopeAsset={id:string;originalValue:string;normalizedValue:string;format:string;type:AssetType;assetValue:AssetValue;active:boolean;updatedAt:string};
type Mode='edit'|'replace'|'retire';
export type ScopeActionResult={message:string;replacementId?:string};
type Props={asset:ManagedScopeAsset;programId:string;onChanged:(result:ScopeActionResult)=>void|Promise<void>};
export default function ScopeAssetActions(props:Props){
 const[action,setAction]=useState<{mode:Mode;asset:ManagedScopeAsset}|null>(null);
 return <><div className="mt-2 flex flex-wrap gap-2">{props.asset.active?<>{(['edit','replace','retire'] as const).map(action=><Button size="sm" variant={action==='retire'?'danger':'ghost'} key={action} aria-label={`${action==='edit'?'Edit scope':action==='replace'?'Replace asset':'Retire asset'} ${props.asset.normalizedValue}`} onClick={()=>setAction({mode:action,asset:{...props.asset}})}>{action==='edit'?'Edit scope':action==='replace'?'Replace':'Retire'}</Button>)}</>:<Button size="sm" variant="ghost" onClick={()=>setAction({mode:'retire',asset:{...props.asset}})}>Retry retirement cleanup</Button>}</div>{action&&<ScopeAssetActionDialog {...props} asset={action.asset} mode={action.mode} onClose={()=>setAction(null)}/>}</>;
}
export function ScopeAssetActionDialog({asset,programId,mode,onChanged,onClose,initialFormat='AUTO'}:Props&{mode:Mode;onClose:()=>void;initialFormat?:string}){
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[value,setValue]=useState(asset.originalValue),[format,setFormat]=useState(initialFormat),[type,setType]=useState(asset.type),[priority,setPriority]=useState(asset.assetValue);
 let preview:ReturnType<typeof detectScopeAsset>|undefined,invalid='';
 if(mode==='replace')try{preview=detectScopeAsset(value);if(format!=='AUTO')preview={...preview,...overrideAssetFormat(preview,format as typeof ASSET_FORMATS[number])};}catch(e){invalid=(e as Error).message;}
 const sameIdentity=preview?.normalizedValue===asset.normalizedValue;
 async function save(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');
  const body=mode==='edit'?{type,assetValue:priority,expectedUpdatedAt:asset.updatedAt}:mode==='replace'?{value,type,assetValue:priority,...(format==='AUTO'?{}:{format}),expectedUpdatedAt:asset.updatedAt,confirmReplacement:true}:{expectedUpdatedAt:asset.updatedAt};
  try{
   const r=await fetch(`/api/programs/${programId}/assets/${asset.id}`,{method:mode==='edit'?'PATCH':mode==='replace'?'POST':'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await r.json();
   if(!r.ok)throw new Error(data.error??'Scope action unavailable');
   const result={message:mode==='replace'?data.cleanupWarning??'Replacement saved. Original authorization retired; historical evidence is preserved.':mode==='edit'?'Scope metadata saved. Historical execution snapshots are unchanged.':'Scope retired. Future execution is blocked; historical evidence is preserved.',...(data.asset?.id?{replacementId:data.asset.id}:{})};
   // The mutation is committed even if the following list refresh fails.
   onClose();await onChanged(result);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const title=mode==='edit'?'Edit scope metadata':mode==='replace'?'Replace scope asset':asset.active?'Retire scope asset':'Retry retirement cleanup';
 return typeof document==='undefined'?null:createPortal(<Dialog title={title} onClose={()=>{if(!busy)onClose();}}><form onSubmit={e=>void save(e)} aria-busy={busy} className="space-y-4">
  <p className="break-all font-mono">{asset.normalizedValue}</p>
  <p className="text-sm text-muted">Format: {asset.format}. Classification and priority are metadata. Format and normalized value identify the authorization and its technical execution identity.</p>
  {mode==='replace'&&<><p>Create the explicitly authorized replacement and retire this asset atomically. If creation fails, the original stays authorized. History, existing reports and Research snapshots remain linked to the original identity.</p><label className="block">Replacement asset<input autoFocus required maxLength={2048} className="mt-1 w-full rounded border bg-surface p-2" value={value} onChange={e=>setValue(e.target.value)} disabled={busy}/></label><label className="block">Replacement format<select aria-label="Replacement format" className="mt-1 w-full rounded border bg-surface p-2" value={format} onChange={e=>setFormat(e.target.value)} disabled={busy}><option value="AUTO">Detected from replacement value</option>{ASSET_FORMATS.map(f=><option key={f} value={f}>{f}</option>)}</select></label>{preview&&<p role="status" className="break-all">Replacement: {preview.normalizedValue} · {preview.format}</p>}{invalid&&<p role="alert">{invalid}</p>}{sameIdentity&&<p>This normalized value already belongs to this asset. Choose a different replacement value; use Edit scope for metadata changes.</p>}</>}
  {mode!=='retire'&&<><label className="block">Asset classification<select aria-label="Asset classification" className="mt-1 w-full rounded border bg-surface p-2" value={type} onChange={e=>setType(e.target.value as AssetType)} disabled={busy}>{ASSET_TYPES.map(t=><option key={t} value={t}>{assetTypeLabel[t]}</option>)}</select></label><label className="block">Asset priority<select aria-label="Asset priority" className="mt-1 w-full rounded border bg-surface p-2" value={priority} onChange={e=>setPriority(e.target.value as AssetValue)} disabled={busy}>{ASSET_VALUES.map(v=><option key={v} value={v}>{assetValueLabel[v]}</option>)}</select></label></>}
  {mode==='retire'&&<p>Retire <strong className="break-all">{asset.normalizedValue}</strong> from authorized Scope. New Recon and Research for this authorization will be refused. Queued/running scans receive cancellation, pending summaries are cancelled, and associated Research is paused. Reports, Recon evidence and captured Research policy remain readable. Discovery and old Recon do not grant authorization.</p>}
  {mode==='replace'&&<label className="flex items-start gap-2"><input type="checkbox" required disabled={busy}/>I confirm authorization for the replacement asset.</label>}
  {error&&<div role="alert"><p>{error}</p><a className="text-brand underline" href={typeof window==='undefined'?`/scopes/${asset.id}`:window.location.href}>Reload view before retrying</a></div>}
  {busy&&<p role="status">Saving scope…</p>}
  <div className="flex flex-wrap gap-3"><Button type="submit" variant={mode==='retire'?'danger':'primary'} disabled={busy||(mode==='replace'&&(!preview||sameIdentity))}>{busy?'Saving…':mode==='edit'?'Save metadata':mode==='replace'?'Confirm replacement':asset.active?'Confirm retirement':'Retry cleanup'}</Button><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button></div>
  <Link className="block text-sm text-brand" href={`/targets/${programId}/settings#out-of-scope`}>Manage program exclusions</Link>
 </form></Dialog>,document.body);
}
