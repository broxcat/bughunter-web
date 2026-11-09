import {safeFindingText} from '@/server/findingPrivacy';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import {Badge,type BadgeTone} from '@/components/ui/Badge';
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
  <form action={'/targets/'+id+'/findings'} className="flex flex-wrap gap-3"><label>Search findings<input name="q" defaultValue={search.q??''} maxLength={200} className="ml-2 rounded border border-border bg-surface p-2"/></label><input type="hidden" name="pageSize" value={collection.pageSize}/><button className="ui-btn" type="submit">Search</button></form>
  <CollectionPager path={'/targets/'+id+'/findings'} query={query.toString()} {...collection}/>
  {!collection.items.length&&<p>No findings match this view. Recon observations are not confirmed vulnerabilities.</p>}
  <div className="ui-table-scroll" role="region" aria-label="Findings inventory" tabIndex={0}><table className="ui-inventory w-full text-left text-sm"><thead><tr>{['Title','Severity','Status','Target','Updated'].map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{collection.items.map(f=><tr key={f.id}><td data-label="Title"><Link className="font-medium text-brand" href={'/targets/'+f.targetId+'/findings?finding='+f.id+'#finding-'+f.id}>{safeFindingText(f.title)}</Link></td><td data-label="Severity"><Badge tone={f.severity.toLowerCase() as BadgeTone}>{f.severity}</Badge></td><td data-label="Status">{f.reviewStatus.toLowerCase().replaceAll('_',' ')}</td><td data-label="Target">{hosts.get(f.targetId)}</td><td data-label="Updated"><time dateTime={new Date(f.updatedAt).toISOString()}>{new Date(f.updatedAt).toISOString().slice(0,10)}</time></td></tr>)}</tbody></table></div></div>;
}
