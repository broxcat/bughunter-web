import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, lstat, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const db=process.env.TEST_DATABASE_URL,schema='research_assessment_'+randomUUID().replaceAll('-','');
if(db){const url=new URL(db);url.searchParams.set('schema',schema);process.env.DATABASE_URL=url.toString();}
let p:typeof import('@/lib/prisma').prisma,sessions:typeof import('@/server/research/sessions'),consoles:typeof import('@/server/research/consoleWorkspace'),assessment:typeof import('@/server/assessment'),workspace:typeof import('@/server/research/workspace');
let root:string,userId:string,programId:string,targetId:string;

(db?describe:describe.skip)('Research assessment metadata persistence without provider or source execution',()=>{
  beforeAll(async()=>{execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));sessions=await import('@/server/research/sessions');consoles=await import('@/server/research/consoleWorkspace');assessment=await import('@/server/assessment');workspace=await import('@/server/research/workspace');root=await mkdtemp(join(tmpdir(),'research-assessment-db-'));process.env.RESEARCH_WORKSPACE_ROOT=join(root,'zip');process.env.RESEARCH_CONSOLE_ROOT=join(root,'console');},30000);
  beforeEach(async()=>{userId=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;programId=(await p.bountyProgram.create({data:{ownerId:userId,companyName:'Assessment fixture',requiredUserAgent:'Research-Assessment/1',scopeRules:['app.example.test'],assessmentMode:'BLACK_BOX'}})).id;const scope=await p.scope.create({data:{userId,hostPattern:'app.example.test',status:'APPROVED'}});targetId=(await p.target.create({data:{userId,programId,scopeId:scope.id,host:'app.example.test',active:true}})).id;});
  afterAll(async()=>{if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}if(root)await rm(root,{recursive:true,force:true});});
  it('captures the same effective source metadata in ZIP and persistent console sessions with read-only policies',async()=>{
    const zip=await sessions.createResearchSession(userId,targetId),console=await consoles.ensureTargetConsole(userId,targetId);
    for(const item of [zip,console.session]){expect(item.authorizationSnapshot).toMatchObject({assessmentMode:'BLACK_BOX',sourceContentAvailable:false,sourceAnalysisPerformed:false,authorizedSources:[]});const base=item.consoleTargetId?process.env.RESEARCH_CONSOLE_ROOT!:process.env.RESEARCH_WORKSPACE_ROOT!;const path=join(base,item.workspaceId,'assessment-policy.json');expect((await lstat(path)).mode&0o777).toBe(0o440);expect(JSON.parse(await readFile(path,'utf8'))).toMatchObject({assessmentMode:'BLACK_BOX',contentAvailable:false});}
    expect(console.target.host).toBe('app.example.test');
  });
  it('keeps an open session and its initial files unchanged after mode and source edits',async()=>{
    const first=await consoles.ensureTargetConsole(userId,targetId),snapshot=JSON.stringify(first.session.authorizationSnapshot),directory=join(process.env.RESEARCH_CONSOLE_ROOT!,first.session.workspaceId),names=['scope.md','assessment-policy.json','.agents/bughunter/target.json','.agents/bughunter/AGENTS.md'];const before=await Promise.all(names.map(name=>readFile(join(directory,name),'utf8')));
    await expect(assessment.setAssessmentMode(userId,programId,'WHITE_BOX',true)).rejects.toMatchObject({status:410});
    const renewed=await consoles.ensureTargetConsole(userId,targetId);expect(renewed.session.id).toBe(first.session.id);expect(JSON.stringify(renewed.session.authorizationSnapshot)).toBe(snapshot);expect(await Promise.all(names.map(name=>readFile(join(directory,name),'utf8')))).toEqual(before);expect(await sessions.researchPolicyState(targetId,userId,renewed.session.authorizationSnapshot)).toBe('CURRENT');
    const next=await sessions.createResearchSession(userId,targetId);expect(next.authorizationSnapshot).toMatchObject({assessmentMode:'BLACK_BOX',authorizedSources:[]});
  });
  it('keeps Recon context handoff bound to the initial session assessment after a new Recon',async()=>{
    await consoles.ensureTargetConsole(userId,targetId);const {generateReconSnapshot}=await import('@/server/research/reconSnapshots');
    const before=await generateReconSnapshot(userId,targetId);expect(before.snapshot?.context.assessment).toMatchObject({assessmentMode:'BLACK_BOX',authorizedSourceCount:0});

    await p.scanRun.create({data:{targetId,type:'RECON',status:'COMPLETED',outcome:'SUCCESS',artifactVersion:2,assessmentModeSnapshot:'BLACK_BOX',assessmentSourcesSnapshot:[]}});
    const after=await generateReconSnapshot(userId,targetId);expect(after.snapshot?.id).not.toBe(before.snapshot?.id);expect(after.snapshot?.context.assessment).toMatchObject({assessmentMode:'BLACK_BOX',authorizedSourceCount:0,assessmentPolicyFile:'assessment-policy.json'});
    expect(JSON.stringify(after.snapshot?.context.assessment)).not.toContain('git.internal.test');
  });
  it('does not retrofit assessment policy into a historical session with missing metadata',async()=>{
    const first=await consoles.ensureTargetConsole(userId,targetId),target=await p.target.findUniqueOrThrow({where:{id:targetId},select:workspace.researchTargetSelect}),historical=workspace.researchAuthorizationSnapshot(target);await p.researchSession.update({where:{id:first.session.id},data:{authorizationSnapshot:historical}});const policyPath=join(process.env.RESEARCH_CONSOLE_ROOT!,first.session.workspaceId,'assessment-policy.json');await rm(policyPath);
    const same=await consoles.ensureTargetConsole(userId,targetId);expect(same.session.authorizationSnapshot).toEqual(historical);expect(workspace.researchAssessmentSnapshot(same.session.authorizationSnapshot).assessmentMode).toBeNull();await expect(access(policyPath)).rejects.toThrow();
  });
  it('keeps scope revocation authoritative even when authorized internal sources exist',async()=>{
    await consoles.ensureTargetConsole(userId,targetId);const target=await p.target.findUniqueOrThrow({where:{id:targetId},select:workspace.researchTargetSelect});expect(()=>workspace.assertResearchTarget({...target,host:'git.internal.test'},userId)).toThrow();await p.scope.update({where:{id:target.scope.id},data:{status:'REVOKED'}});await expect(consoles.ensureTargetConsole(userId,targetId)).rejects.toThrow(/scope/i);
  });
});
