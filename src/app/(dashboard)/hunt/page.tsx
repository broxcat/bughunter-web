import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CollectionPager from '@/components/CollectionPager';
import {paginationInput,paginationBounds} from '@/lib/pagination';
export default async function LegacyHuntPage({searchParams}:{searchParams:Promise<{page?:string;pageSize?:string;q?:string}>}) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const search=await searchParams,query=new URLSearchParams(Object.entries(search).filter((e):e is [string,string]=>typeof e[1]==='string')),input=paginationInput(query,false);
  const userId=session.user.id;
  const where={type:'HUNT' as const,target:{userId,OR:[{program:null},{program:{ownerId:userId}}],...(input.q?{host:{contains:input.q,mode:'insensitive' as const}}:{})}};
  const collection=await prisma.$transaction(async tx=>{
    const bounds=paginationBounds(input,await tx.scanRun.count({where}));
    const items=await tx.scanRun.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:bounds.skip,take:bounds.pageSize,select:{id:true,status:true,createdAt:true,target:{select:{host:true}}}});
    return{...bounds,items};
  },{isolationLevel:'RepeatableRead'}),runs=collection.items;
  return <div className="space-y-5"><h1 className="text-2xl">Legacy hunt history</h1><p>The vulnerability-family hunt engine is retired. Existing runs remain read-only.</p><Link href="/research" className="text-brand">Open research →</Link><form action="/hunt" className="flex flex-wrap gap-3"><label>Search hosts<input name="q" defaultValue={input.q} maxLength={200} className="ml-2 rounded border border-border bg-surface p-2"/></label><input type="hidden" name="pageSize" value={input.pageSize}/><button className="ui-btn" type="submit">Search</button></form><CollectionPager path="/hunt" query={query.toString()} {...collection} label="Hunt history pages"/><ul>{runs.map(r => <li key={r.id}><Link className="text-brand" href={`/hunt/${r.id}`}>{r.target.host} · {r.status} · {r.createdAt.toISOString()}</Link></li>)}</ul>{!runs.length && <p>No historical hunts.</p>}</div>;
}
