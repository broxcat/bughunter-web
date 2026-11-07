'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense,useEffect,useState } from 'react';
import { assetTypeLabel,assetValueLabel,assetReconStatus,type AssetType,type AssetValue } from '@/lib/scopeAssets';
import CollectionPager from '@/components/CollectionPager';
import { paginationInput } from '@/lib/pagination';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
type Program={id:string;companyName:string};
type Asset={id:string;normalizedValue:string;format:string;type:AssetType;assetValue:AssetValue;active:boolean;program:Program;scanRuns:{status:string;outcome:string|null;finishedAt:string|null;_count:{artifacts:number}}[]};
type Legacy={id:string;host:string;programId:string|null};
export default function ScopesPage(){return <Suspense fallback={<p role="status">Loading Scope…</p>}><ScopeCollection/></Suspense>;}
function ScopeCollection(){
  const router=useRouter(),params=useSearchParams(),query=params.toString(),target=params.get('target')??'';
  const input=paginationInput(new URLSearchParams(query),false),key=JSON.stringify([target,input]);
  const legacyInput=paginationInput(new URLSearchParams({page:params.get('legacyPage')??'1',pageSize:String(input.pageSize)}),false);
  const [legacyPages,setLegacyPages]=useState<{page:number;pages:number;total:number}|null>(null);
  const [result,setResult]=useState<{key:string;page:number;pages:number;total:number;items:Asset[]}|null>(null);
  const data=result?.key===key?result:null,assets=data?.items??[];
  const [programs,setPrograms]=useState<Program[]>([]),[legacy,setLegacy]=useState<Legacy[]>([]),[error,setError]=useState('');
  useEffect(()=>{const c=new AbortController();fetch('/api/programs?options=1',{signal:c.signal}).then(async r=>{if(!r.ok)throw new Error('Unable to load Target choices');setPrograms(await r.json());}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[]);
  useEffect(()=>{const c=new AbortController();fetch(`/api/targets?legacy=1&page=${legacyInput.page}&pageSize=${legacyInput.pageSize}`,{signal:c.signal}).then(async r=>{
    if(!r.ok)throw new Error('Unable to load previous hosts');const body=await r.json();if(c.signal.aborted)return;setLegacy(body.items);setLegacyPages(body);
    const current=new URLSearchParams(window.location.search);if(current.has('legacyPage')&&current.get('legacyPage')!==String(body.page)){current.set('legacyPage',String(body.page));router.replace('/scopes?'+current);}
  }).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[query,legacyInput.page,legacyInput.pageSize,router]);
  useEffect(()=>{const controller=new AbortController();
    const q=new URLSearchParams({page:String(input.page),pageSize:String(input.pageSize),q:input.q,target});
    fetch('/api/scope-assets?'+q,{cache:'no-store',signal:controller.signal}).then(async r=>{
      if(!r.ok)throw new Error('Unable to load scope assets');const body=await r.json();
      if(controller.signal.aborted)return;setResult({...body,key});setError('');
      const current=new URLSearchParams(query);
      if(current.has('page')&&current.get('page')!==String(body.page)){current.set('page',String(body.page));router.replace('/scopes?'+current);}
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();
  },[target,input.page,input.pageSize,input.q,key,query,router]);
  async function adopt(e:React.FormEvent<HTMLFormElement>,host:Legacy){e.preventDefault();const program=new FormData(e.currentTarget).get('program');try{const r=await fetch(`/api/programs/${program}/hosts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:host.host,legacyTargetId:host.id})});if(!r.ok)throw new Error((await r.json()).error);setLegacy(rows=>rows.filter(h=>h.id!==host.id));router.push('/scopes?target='+program);}catch(e){setError((e as Error).message);}}
  const choices=[...new Map([...programs,...assets.map(a=>a.program)].map(p=>[p.id,p])).values()].sort((a,b)=>a.companyName.localeCompare(b.companyName)||a.id.localeCompare(b.id));
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">Scopes</h1><p className="text-muted">Inspect authorized assets and their Recon intelligence. Launch Recon from the Target.</p><label>Target<select aria-label="Filter Target" className="ml-3 rounded border border-border bg-surface p-2" value={target} onChange={e=>{const q=new URLSearchParams(query);q.set('target',e.target.value);q.delete('page');router.push('/scopes?'+q);}}><option value="">All Targets</option>{target&&!choices.some(p=>p.id===target)&&<option value={target}>Unavailable Target</option>}{choices.map(p=><option key={p.id} value={p.id}>{p.companyName}</option>)}</select></label>{error&&<p role="alert">{error}</p>}
    {[...new Map(assets.map(a=>[a.program.id,a.program])).values()].map(p=><Card key={p.id} className="space-y-3 p-4"><Link className="text-lg font-semibold text-brand" href={'/targets/'+p.id}>{p.companyName}</Link><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr>{['Asset','Format','Type','Value','Recon'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{assets.filter(a=>a.program.id===p.id).map(a=><tr className="border-t border-border" key={a.id}><td className="max-w-72 break-all p-2"><Link className="text-brand" href={'/scopes/'+a.id}>{a.normalizedValue}</Link>{!a.active&&<span className="ml-2 text-muted">Archived</span>}</td><td className="p-2">{a.format.toLowerCase().replaceAll('_',' ')}</td><td className="p-2">{assetTypeLabel[a.type]}</td><td className="p-2">{assetValueLabel[a.assetValue]}</td><td className="p-2">{assetReconStatus(a.scanRuns[0]??null).toLowerCase().replaceAll('_',' ')} · {a.scanRuns[0]?._count.artifacts??0} observations</td></tr>)}</tbody></table></div></Card>)}
    <form action="/scopes" className="flex flex-wrap gap-3"><label>Search assets<input name="q" defaultValue={input.q} key={input.q} maxLength={200} className="ml-2 rounded border border-border bg-surface p-2"/></label><input type="hidden" name="target" value={target}/><input type="hidden" name="pageSize" value={input.pageSize}/><Button type="submit">Search</Button></form>
    {data&&<CollectionPager path="/scopes" query={query} {...data}/>}
    {!data&&!error&&<p role="status">Loading Scope…</p>}
    {data&&!assets.length&&!error&&<p>No Scope assets match this view. <Link className="text-brand" href="/targets">Open Targets to configure Scope Assets →</Link></p>}
    {legacyPages&&legacyPages.total>0&&<details open={Boolean(params.get('legacyPage'))}><summary>Previous hosts and scan history</summary><CollectionPager path="/scopes" query={query} {...legacyPages} pageKey="legacyPage" label="Previous host pages" noun="previous hosts"/><p className="py-3 text-sm text-muted">Explicitly add a previous host to a Target to authorize future work. Its history stays attached.</p>{legacy.map(h=><Card className="mb-2 flex flex-wrap gap-3 p-3" key={h.id}><Link href={'/hosts/'+h.id} className="text-brand">{h.host} — History</Link>{programs.length>0&&<form className="flex min-w-0 max-w-full flex-wrap gap-2" onSubmit={e=>void adopt(e,h)}><select aria-label={'Target for '+h.host} name="program" className="min-w-0 max-w-full bg-surface">{programs.map(p=><option value={p.id} key={p.id}>{p.companyName}</option>)}</select><Button type="submit" size="sm">Add to Scope</Button></form>}</Card>)}</details>}
  </div>;
}
