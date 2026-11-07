import {safeFindingText} from '@/server/findingPrivacy';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import HostFindings from '@/components/HostFindings';
import {paginationInput} from '@/lib/pagination';
import {findingCollection} from '@/server/findingCollections';
import CollectionPager from '@/components/CollectionPager';
export default async function FindingsPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{page?:string;pageSize?:string;q?:string}>}){
 const {id}=await params,s=await auth();if(!s?.user?.id)return null;
 const program=await prisma.bountyProgram.findFirst({where:{id,ownerId:s.user.id},select:{companyName:true}});
 if(!program){if(!await prisma.target.findFirst({where:{id,userId:s.user.id}}))notFound();return <HostFindings params={params}/>;}
 const search=await searchParams,query=new URLSearchParams(Object.entries(search).filter((e):e is [string,string]=>typeof e[1]==='string'));
 const collection=await findingCollection(s.user.id,{programId:id},paginationInput(query,false));
 const targetIds=[...new Set(collection.items.map(f=>f.targetId))];
 const targets=await prisma.target.findMany({where:{id:{in:targetIds},userId:s.user.id},select:{id:true,host:true}}),hosts=new Map(targets.map(t=>[t.id,t.host]));
 return <div className="space-y-5"><Link href={'/targets/'+id} className="text-brand">← {program.companyName}</Link><h1 className="text-2xl font-semibold">Findings</h1>
  <form action={'/targets/'+id+'/findings'} className="flex flex-wrap gap-3"><label>Search Findings<input name="q" defaultValue={search.q??''} maxLength={200} className="ml-2 rounded border border-border bg-surface p-2"/></label><input type="hidden" name="pageSize" value={collection.pageSize}/><button className="ui-btn" type="submit">Search</button></form>
  <CollectionPager path={'/targets/'+id+'/findings'} query={query.toString()} {...collection}/>
  {!collection.items.length&&<p>No Findings match this view. Recon observations are not confirmed vulnerabilities.</p>}
  <ul className="space-y-3">{collection.items.map(f=><li key={f.id} className="rounded border border-border p-4"><Link className="text-brand" href={'/targets/'+f.targetId+'/findings'}>{safeFindingText(f.title)}</Link><p className="text-sm text-muted">{hosts.get(f.targetId)} · {f.severity} · {f.reviewStatus}</p></li>)}</ul></div>;
}
