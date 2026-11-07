"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ProgramForm from "@/components/ProgramForm";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {paginationInput} from '@/lib/pagination';
import CollectionPager from '@/components/CollectionPager';
import type {programCollection} from '@/server/programCollection';
export default function TargetsPage() { return <Suspense fallback={<p role="status">Loading Targets…</p>}><TargetsCollection/></Suspense>; }
function TargetsCollection() {
  const router = useRouter();
  const params=useSearchParams(), query=params.toString(), input=paginationInput(new URLSearchParams(query),false);
  const key=JSON.stringify(input);
  const [result,setResult]=useState<(Awaited<ReturnType<typeof programCollection>> & {key:string})|null>(null);
  const data=result?.key===key?result:null, programs=data?.items??[];
  const [deleted, setDeleted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller=new AbortController();
    fetch('/api/programs?'+new URLSearchParams({page:String(input.page),pageSize:String(input.pageSize),q:input.q}),{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('Unable to load targets');
      const body=await response.json();if(controller.signal.aborted)return;
      setResult({...body,key});setError('');setDeleted(new URLSearchParams(query).get('deleted')==='1');
      const current=new URLSearchParams(query);
      if(current.has('page')&&current.get('page')!==String(body.page)){current.set('page',String(body.page));router.replace('/targets?'+current);}
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[key,query,input.page,input.pageSize,input.q,router]);
  return <div className="space-y-6"><div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Targets</h1><Button onClick={() => setCreating(!creating)}>{creating ? "Cancel" : "Create Target"}</Button></div><p className="text-muted">Your bug bounty targets. Manage scope assets, Recon, Research and Findings from each Target.</p>
    <form action="/targets" className="flex flex-wrap gap-3"><label>Search Targets<input name="q" maxLength={200} defaultValue={input.q} key={input.q} className="ml-2 rounded border border-border bg-surface p-2"/></label><input type="hidden" name="pageSize" value={input.pageSize}/><Button type="submit">Search</Button></form>
    {!data&&!error&&<p role="status">Loading Targets…</p>}
    {data&&!creating&&<CollectionPager path="/targets" query={query} {...data}/>}
    {deleted && <p role="status">Target permanently deleted and resources cleaned up.</p>}
    {error && <p role="alert">{error}</p>}
    {creating ? <Card className="p-6"><ProgramForm onSaved={id => router.push(`/targets/${id}`)} /></Card> : programs.map(p => <Card className="p-5" key={p.id}><Link className="text-xl font-semibold text-brand" href={`/targets/${p.id}`}>{p.companyName}</Link><Link className="float-right text-sm text-muted" href={`/targets/${p.id}/settings`}>Settings</Link><p>{p.platform ?? "Private program"} · Scope — {p._count.scopeAssets} assets</p></Card>)}
    {!creating && data && !programs.length && !error && <p>{input.q?'No Targets match this view. Clear the search.':'Create your first Target to add hosts and start Recon.'}</p>}
  </div>;
}
