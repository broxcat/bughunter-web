/** Seed an archived export for evidence tests; production has no workspace launcher. */
import { prisma } from '@/lib/prisma';
import { createResearchBundle, newWorkspaceId, researchTargetSelect, researchAuthorizationSnapshot, writeResearchWorkspace } from '@/server/research/workspace';
import { researchRoot } from '@/server/research/sessions';
export async function createResearchSession(userId:string,targetId:string){
 const target=await prisma.target.findFirstOrThrow({where:{id:targetId,userId},select:researchTargetSelect});
 const session=await prisma.researchSession.create({data:{userId,targetId,workspaceId:newWorkspaceId(),targetHost:target.host,programName:target.program?.companyName??target.host,scopeMarkdown:'# Historical scope',authorizationSnapshot:researchAuthorizationSnapshot(target),status:'READY'}});
 const files=createResearchBundle(target,null,[],session);
 await writeResearchWorkspace(researchRoot(),session.workspaceId,files);
 return prisma.researchSession.update({where:{id:session.id},data:{files:Object.keys(files),scopeMarkdown:files['scope.md']??session.scopeMarkdown}});
}
