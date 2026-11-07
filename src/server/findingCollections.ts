import {prisma} from '@/lib/prisma';
import {paginationBounds,type PageRequest} from '@/lib/pagination';
import {publicFinding,safeFindingText} from './findingPrivacy';
import {loadOobHitsByToken} from '@/lib/oobHits';

export async function findingCollection(userId:string,identity:{programId?:string;targetId?:string},input:PageRequest){
 const where={target:{userId,...(identity.programId?{programId:identity.programId}:{id:identity.targetId})},...(input.q?{title:{contains:input.q,mode:'insensitive' as const}}:{})};
 const result=await prisma.$transaction(async tx=>{
  const bounds=paginationBounds(input,await tx.finding.count({where}));
  const rows=await tx.finding.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:bounds.skip,take:bounds.pageSize,
   include:{lifecycleEvents:{where:{state:'VALIDATED'},take:1,select:{id:true}}}});
  return{...bounds,rows};
 },{isolationLevel:'RepeatableRead'});
 const hits=await loadOobHitsByToken(result.rows.flatMap(r=>r.oobToken?[r.oobToken]:[]));
 const {rows,...bounds}=result;
 return{...bounds,items:rows.map(r=>({...publicFinding(r),oobHits:r.oobToken?hits.get(r.oobToken)??[]:[]}))};
}
export async function reportCollection(userId:string,identity:{programId?:string;targetId?:string},input:PageRequest){
 const where={userId,...(identity.programId?{items:{some:{finding:{target:{programId:identity.programId,userId}}}}}:identity.targetId?{targetId:identity.targetId}:{}),...(input.q?{title:{contains:input.q,mode:'insensitive' as const}}:{})};
 return prisma.$transaction(async tx=>{
  const bounds=paginationBounds(input,await tx.report.count({where}));
  const rows=await tx.report.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:bounds.skip,take:bounds.pageSize,include:{items:{select:{finding:{select:{targetId:true}}}}}});
  return{...bounds,items:rows.map(r=>({...r,title:safeFindingText(r.title),markdown:r.markdown?safeFindingText(r.markdown):r.markdown,evidenceTargetIds:[...new Set(r.items.map(i=>i.finding.targetId))]}))};
 },{isolationLevel:'RepeatableRead'});
}
