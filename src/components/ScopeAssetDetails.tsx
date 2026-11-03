'use client';
import Link from 'next/link';
import { useCallback,useEffect,useState } from 'react';
import ScanLogViewer from './ScanLogViewer';
import ReconSummaryButton from './ReconSummaryButton';
type Detail={asset:{normalizedValue:string;program:{companyName:string}};run:{id:string;status:string;reconSteps:{name:string;state:string;reason:string|null}[]}|null};
export default function ScopeAssetDetails({programId,assetId}:{programId:string;assetId:string}){
  const[data,setData]=useState<Detail|null>(null),[error,setError]=useState('');
  const refresh=useCallback(async()=>{const r=await fetch(`/api/programs/${programId}/assets/${assetId}/recon?console=1`,{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error??'Scope unavailable');setData(j);setError('');},[programId,assetId]);
  useEffect(()=>{void Promise.resolve().then(refresh).catch(e=>setError(e.message));const timer=setInterval(()=>{void refresh().catch(e=>setError(e.message));},5000);return()=>clearInterval(timer);},[refresh]);
  if(!data)return <p role="status">{error||'Loading Scope…'}</p>;
  return <div className="space-y-5"><Link className="text-sm text-brand" href={'/targets/'+programId}>← {data.asset.program.companyName}</Link><h1 className="break-all text-2xl font-semibold">{data.asset.normalizedValue}</h1><div className="flex items-center gap-3"><ReconSummaryButton programId={programId} assetId={assetId}/><a className="text-sm text-brand" href={`/api/programs/${programId}/assets/${assetId}/scope.md`}>Download scope.md</a></div>{error&&<p role="alert">{error}</p>}{data.run?<ScanLogViewer scanRunId={data.run.id} stages={data.run.reconSteps} cancelled={data.run.status==='CANCELLED'}/>:<div className="rounded border border-neutral-800 bg-neutral-950 p-5 font-mono text-sm text-neutral-300"><h2>Recon Console</h2><p className="mt-4">Pending · Start Recon from the Target page.</p></div>}</div>;
}
