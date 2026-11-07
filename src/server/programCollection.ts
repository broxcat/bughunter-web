import { prisma } from '@/lib/prisma';
import { paginationBounds, type PageRequest } from '@/lib/pagination';
/** Repeatable read keeps count/clamp and the bounded rows in one snapshot. */
export function programCollection(ownerId:string,input:PageRequest) {
  return prisma.$transaction(async tx=>{
    const where={ownerId,...(input.q?{companyName:{contains:input.q,mode:'insensitive' as const}}:{})};
    const bounds=paginationBounds(input,await tx.bountyProgram.count({where}));
    const items=await tx.bountyProgram.findMany({where,orderBy:[{companyName:'asc'},{id:'asc'}],skip:bounds.skip,take:bounds.pageSize,
      select:{id:true,companyName:true,platform:true,deletingAt:true,_count:{select:{scopeAssets:{where:{active:true}}}},reconRuns:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{id:true,status:true,outcome:true,createdAt:true}}}});
    return {...bounds,items};
  },{isolationLevel:'RepeatableRead'});
}
