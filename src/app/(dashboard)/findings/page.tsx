import Link from 'next/link';
import {auth} from '@/lib/auth';
import {prisma} from '@/lib/prisma';
import {paginationInput,paginationBounds} from '@/lib/pagination';
import CollectionPager from '@/components/CollectionPager';
import {Badge,type BadgeTone} from '@/components/ui/Badge';
import {safeFindingText} from '@/server/findingPrivacy';

export default async function FindingsPage({searchParams}:{searchParams:Promise<{page?:string;pageSize?:string;q?:string}>}){
  const session=await auth();
  if(!session?.user?.id)return null;
  const search=await searchParams;
  const query=new URLSearchParams(Object.entries(search).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
  const input=paginationInput(query,false);
  const where={target:{userId:session.user.id},...(input.q?{title:{contains:input.q,mode:'insensitive' as const}}:{})};
  const result=await prisma.$transaction(async tx=>{
    const bounds=paginationBounds(input,await tx.finding.count({where}));
    const items=await tx.finding.findMany({
      where,
      orderBy:[{updatedAt:'desc'},{id:'desc'}],
      skip:bounds.skip,
      take:bounds.pageSize,
      select:{id:true,title:true,severity:true,reviewStatus:true,updatedAt:true,target:{select:{id:true,host:true,program:{select:{id:true,companyName:true}}}}},
    });
    return{...bounds,items};
  },{isolationLevel:'RepeatableRead'});
  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">Findings</h1>
    <form action="/findings" className="flex flex-wrap gap-3">
      <label>Search findings<input name="q" defaultValue={input.q} maxLength={200} className="ml-2 rounded border border-border bg-surface p-2"/></label>
      <input type="hidden" name="pageSize" value={result.pageSize}/>
      <button className="ui-btn" type="submit">Search</button>
    </form>
    <CollectionPager path="/findings" query={query.toString()} {...result}/>
    {!result.items.length?<p>No findings match this view.</p>:<div className="ui-table-scroll" role="region" aria-label="Findings inventory" tabIndex={0}>
      <table className="ui-inventory w-full text-left text-sm">
        <thead><tr>{['Title','Severity','Status','Target','Updated'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{result.items.map(f=><tr key={f.id}>
          <td data-label="Title"><Link className="font-medium text-brand" href={'/targets/'+f.target.id+'/findings?finding='+f.id+'#finding-'+f.id}>{safeFindingText(f.title)}</Link></td>
          <td data-label="Severity"><Badge tone={f.severity.toLowerCase() as BadgeTone}>{f.severity}</Badge></td>
          <td data-label="Status">{f.reviewStatus.toLowerCase().replaceAll('_',' ')}</td>
          <td data-label="Target"><div><span>{f.target.program?.companyName??'Legacy host'}</span><p className="text-xs text-muted">{f.target.host}</p></div></td>
          <td data-label="Updated"><time dateTime={f.updatedAt.toISOString()}>{f.updatedAt.toISOString().slice(0,10)}</time></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}
