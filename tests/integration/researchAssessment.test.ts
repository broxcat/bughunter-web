import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createHistoricalSession } from '../fixtures/researchHistory';
const db=process.env.TEST_DATABASE_URL,schema='research_assessment_'+randomUUID().replaceAll('-','');
if(db){const url=new URL(db);url.searchParams.set('schema',schema);process.env.DATABASE_URL=url.toString();}
let p:typeof import('@/lib/prisma').prisma,sessions:typeof import('@/server/research/sessions'),assessment:typeof import('@/server/assessment'),workspace:typeof import('@/server/research/workspace');
let userId:string,programId:string,targetId:string;

// Sessions are no longer provisioned; historical rows keep their captured assessment.
(db?describe:describe.skip)('Historical Research assessment metadata without provider or source execution',()=>{
  beforeAll(async()=>{execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));sessions=await import('@/server/research/sessions');assessment=await import('@/server/assessment');workspace=await import('@/server/research/workspace');},30000);
  beforeEach(async()=>{userId=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;programId=(await p.bountyProgram.create({data:{ownerId:userId,companyName:'Assessment fixture',requiredUserAgent:'Research-Assessment/1',scopeRules:['app.example.test'],assessmentMode:'BLACK_BOX'}})).id;const scope=await p.scope.create({data:{userId,hostPattern:'app.example.test',status:'APPROVED'}});targetId=(await p.target.create({data:{userId,programId,scopeId:scope.id,host:'app.example.test',active:true}})).id;});
  afterAll(async()=>{if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}});
  it('keeps a historical snapshot unchanged and CURRENT when white-box mode is refused',async()=>{
    const first=await createHistoricalSession(p,userId,targetId),snapshot=JSON.stringify(first.authorizationSnapshot);
    await expect(assessment.setAssessmentMode(userId,programId,'WHITE_BOX',true)).rejects.toMatchObject({status:410});
    const stored=await p.researchSession.findUniqueOrThrow({where:{id:first.id}});expect(JSON.stringify(stored.authorizationSnapshot)).toBe(snapshot);expect(await sessions.researchPolicyState(targetId,userId,stored.authorizationSnapshot)).toBe('CURRENT');
  });
  it('does not retrofit assessment policy into a historical session with missing metadata',async()=>{
    const historical=await createHistoricalSession(p,userId,targetId);
    expect(workspace.researchAssessmentSnapshot(historical.authorizationSnapshot).assessmentMode).toBeNull();
    expect((await p.researchSession.findUniqueOrThrow({where:{id:historical.id}})).authorizationSnapshot).toEqual(historical.authorizationSnapshot);
  });
  it('keeps scope revocation authoritative for historical sessions',async()=>{
    const historical=await createHistoricalSession(p,userId,targetId),target=await p.target.findUniqueOrThrow({where:{id:targetId},select:workspace.researchTargetSelect});
    expect(()=>workspace.assertResearchTarget({...target,host:'git.internal.test'},userId)).toThrow();
    await p.scope.update({where:{id:target.scope.id},data:{status:'REVOKED'}});
    expect(await sessions.researchPolicyState(targetId,userId,historical.authorizationSnapshot)).toBe('INACTIVE');
  });
});
