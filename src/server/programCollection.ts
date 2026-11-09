import { prisma } from '@/lib/prisma';
import { programPolicyBlocker, programPolicyInclude } from './programExecutionPolicy';
import { paginationBounds, type PageRequest } from '@/lib/pagination';
/** Repeatable read keeps count/clamp and the bounded rows in one snapshot. */
export function programCollection(ownerId:string,input:PageRequest) {
  return prisma.$transaction(async tx=>{
    const where={ownerId,...(input.q?{companyName:{contains:input.q,mode:'insensitive' as const}}:{})};
    const bounds=paginationBounds(input,await tx.bountyProgram.count({where}));
    const items=await tx.bountyProgram.findMany({where,orderBy:[{companyName:'asc'},{id:'asc'}],skip:bounds.skip,take:bounds.pageSize,
      select:{...programPolicyInclude,id:true,ownerId:true,companyName:true,platform:true,deletingAt:true,requiredUserAgent:true,programUrl:true,outOfScope:true,rulesOfEngagement:true,_count:{select:{scopeAssets:{where:{active:true}}}},reconRuns:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{id:true,status:true,outcome:true,createdAt:true}}}});
    return { ...bounds, items: items.map(program => {
      const { id, companyName, platform, deletingAt, _count, reconRuns } = program;
      return { id, companyName, platform, deletingAt, _count, reconRuns, policyBlocker: programPolicyBlocker(program) };
    }) };
  },{isolationLevel:'RepeatableRead'});
}
