'use client';
import Link from 'next/link';
import {assetTypeLabel} from '@/lib/scopeAssets';
import ScopeAssetActions,{type ManagedScopeAsset,type ScopeActionResult} from './ScopeAssetActions';
import ReconHistory from './ReconHistory';
import { useCallback,useEffect,useState } from 'react';
import ScanLogViewer from './ScanLogViewer';
import ReconSummaryButton from './ReconSummaryButton';
type Detail={asset:ManagedScopeAsset&{program:{companyName:string}};run:{id:string;status:string;reconSteps:{name:string;state:string;reason:string|null}[]}|null};
export default function ScopeAssetDetails({programId,assetId}:{programId:string;assetId:string}){
  const[notice,setNotice]=useState<ScopeActionResult|null>(null);
  const[data,setData]=useState<Detail|null>(null),[error,setError]=useState('');
  const refresh=useCallback(async()=>{const r=await fetch(`/api/programs/${programId}/assets/${assetId}/recon?console=1`,{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error??'Scope unavailable');setData(j);setError('');},[programId,assetId]);
  useEffect(()=>{void Promise.resolve().then(refresh).catch(e=>setError(e.message));const timer=setInterval(()=>{void refresh().catch(e=>setError(e.message));},5000);return()=>clearInterval(timer);},[refresh]);
  if(!data)return error?<p role="alert">{error}</p>:<p role="status">Loading Scope…</p>;
  return <div className="space-y-5"><Link className="text-sm text-brand" href={'/targets/'+programId}>← {data.asset.program.companyName}</Link><h1 className="break-all text-2xl font-semibold">{data.asset.normalizedValue}</h1><p className="text-sm text-muted">{data.asset.format.toLowerCase().replaceAll('_',' ')} · {assetTypeLabel[data.asset.type]} · {data.asset.active?'Active':'Retired'}</p>{!data.asset.active&&<p role="status">Retired Scope asset — history retained; no current execution authorization.</p>}{notice&&<p role="status">{notice.message}{notice.replacementId&&<Link className="ml-2 text-brand underline" href={"/scopes/"+notice.replacementId}>Open replacement</Link>}</p>}<ScopeAssetActions asset={data.asset} programId={programId} onChanged={async result=>{setNotice(result);try{await refresh();}catch(e){setError((e as Error).message);}}}/><Link className="text-brand underline" href={`/targets/${programId}/settings#out-of-scope`}>Manage program exclusions</Link><div className="flex flex-wrap items-center gap-3"><ReconSummaryButton programId={programId} assetId={assetId}/><a className="text-sm text-brand" href={`/api/programs/${programId}/assets/${assetId}/scope.md`}>Download scope.md</a></div><ReconHistory assetId={assetId}/>{error&&<p role="alert">{error}</p>}{data.run?<ScanLogViewer scanRunId={data.run.id} stages={data.run.reconSteps} cancelled={data.run.status==='CANCELLED'}/>:<div className="rounded border border-border bg-surface-2 p-5 text-sm text-muted"><h2>Recon Console</h2><p className="mt-4">Pending · Start Recon from the Target page.</p></div>}</div>;
}
