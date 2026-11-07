import Link from 'next/link';
import {pageHref} from '@/lib/pagination';
export default function CollectionPager({path,query,page,pages,total,pageKey="page",label="Collection pages",noun="results"}:{path:string;query:string;page:number;pages:number;total:number;pageKey?:string;label?:string;noun?:string}){
  return <nav aria-label={label} className="collection-pager flex flex-wrap items-center gap-x-4 gap-y-2">
    {page>1?<Link className="text-brand" href={pageHref(path,query,page-1,pageKey)}>Previous page</Link>:<span aria-disabled="true">Previous page</span>}
    <span role="status">Page {page} of {pages} · {total} {noun}</span>
    {page<pages?<Link className="text-brand" href={pageHref(path,query,page+1,pageKey)}>Next page</Link>:<span aria-disabled="true">Next page</span>}
  </nav>;
}
