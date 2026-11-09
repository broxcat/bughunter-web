"use client";
import {platformLabel} from '@/lib/platformPresentation';
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ProgramForm from "@/components/ProgramForm";
import { Dialog } from "@/components/ui/Dialog";
import { MISSING_HUNTER_UA, POLICY_REVIEW_ANCHOR } from '@/lib/programExecutionPolicy';
import { reconOverview } from "@/lib/reconOverview";
import { Button } from "@/components/ui/Button";
import {paginationInput} from '@/lib/pagination';
import CollectionPager from '@/components/CollectionPager';
import type {programCollection} from '@/server/programCollection';
export default function TargetsPage() { return <Suspense fallback={<p role="status">Loading targets…</p>}><TargetsCollection/></Suspense>; }
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
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1>Targets</h1><Button onClick={() => setCreating(true)}>Create target</Button></div>
    <form action="/targets" className="flex flex-wrap gap-3"><label>Search targets<input name="q" maxLength={200} defaultValue={input.q} key={input.q} className="rounded border bg-surface p-2"/></label><input type="hidden" name="pageSize" value={input.pageSize}/><Button variant="secondary" type="submit">Search</Button></form>
    {!data&&!error&&<p role="status">Loading targets…</p>}
    {deleted && <p role="status">Target deleted.</p>}{error && <p role="alert">{error}</p>}
    {!!programs.length && <div className="ui-table-scroll" role="region" aria-label="Program inventory" tabIndex={0}><table className="ui-inventory ui-targets w-full text-left text-sm"><caption className="sr-only">Program inventory</caption><thead><tr>{['Target','Platform','Scope','Latest recon',''].map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{programs.map(p=><tr key={p.id}>
      <td data-label="Target"><span className="font-medium">{p.companyName}</span>
        {p.policyBlocker && <Link className="ml-2 inline-block rounded border px-2 py-0.5 text-xs text-brand"
          href={p.policyBlocker === MISSING_HUNTER_UA ? '/settings#hunter-identity' : '/targets/' + p.id + '/settings#' + POLICY_REVIEW_ANCHOR}>
          Policy review needed
        </Link>}{p.deletingAt&&<p role="status" className="text-xs text-muted">Deletion pending</p>}</td>
      <td data-label="Platform" className="text-muted">{platformLabel(p.platform)}</td><td data-label="Scope">{p._count.scopeAssets} assets</td><td data-label="Latest recon">{reconOverview(p.reconRuns[0]??null).label}</td>
      <td data-label="Action"><Link className="font-medium text-brand" aria-label={`Open ${p.companyName}`} href={`/targets/${p.id}`}>Open</Link></td>
    </tr>)}</tbody></table></div>}
    {data&&<CollectionPager path="/targets" query={query} {...data}/>}
    {data&&!programs.length&&!error&&<p className="text-sm text-muted">{input.q?'No targets match your search.':'No targets yet. Create a target to define its scope.'}</p>}
    {creating&&<Dialog compact title="Create target" onClose={()=>setCreating(false)}><ProgramForm onCancel={()=>setCreating(false)} onSaved={id=>router.push(`/scopes?target=${id}`)}/></Dialog>}
  </div>;
}
