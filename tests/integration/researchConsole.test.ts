import { describe, it, beforeAll, beforeEach, afterAll, vi, expect } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyTerminalTicket } from '@/lib/research/terminal';
const mocks = vi.hoisted(()=>({auth:vi.fn()})); vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
const db=process.env.TEST_DATABASE_URL, schema=`console_${randomUUID().replaceAll('-','')}`;
if(db){const u=new URL(db);u.searchParams.set('schema',schema);process.env.DATABASE_URL=u.toString();}
let prisma: typeof import('@/lib/prisma').prisma, ensure: typeof import('@/server/research/consoleWorkspace').ensureTargetConsole, route: typeof import('@/app/api/research-targets/[id]/terminal/route').POST;
let root:string,userId:string,otherId:string,targetId:string,publicKey:string;
(db?describe:describe.skip)('owned persistent Target console admission',()=>{
 beforeAll(async()=>{
  execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});
  ({prisma}=await import('@/lib/prisma'));({ensureTargetConsole:ensure}=await import('@/server/research/consoleWorkspace'));({POST:route}=await import('@/app/api/research-targets/[id]/terminal/route'));
  root=await mkdtemp(join(tmpdir(),'console-db-'));process.env.RESEARCH_CONSOLE_ROOT=root;process.env.AUTH_URL='http://app.example.test';
  const pair=generateKeyPairSync('ed25519');publicKey=pair.publicKey.export({type:'spki',format:'pem'}).toString();
  process.env.RESEARCH_TERMINAL_PRIVATE_KEY_FILE=join(root,'private.pem'); await writeFile(process.env.RESEARCH_TERMINAL_PRIVATE_KEY_FILE,pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  otherId=(await prisma.user.create({data:{email:`${randomUUID()}@example.test`}})).id;
 },30000);
 beforeEach(async()=>{
  userId=(await prisma.user.create({data:{email:`${randomUUID()}@example.test`}})).id;mocks.auth.mockResolvedValue({user:{id:userId}});
  const scope=await prisma.scope.create({data:{userId,hostPattern:'app.example.test',status:'APPROVED'}}),program=await prisma.bountyProgram.create({data:{ownerId:userId,companyName:'Console synthetic fixture',requiredUserAgent:'Console-UA/1'}});
  targetId=(await prisma.target.create({data:{userId,scopeId:scope.id,programId:program.id,host:'app.example.test'}})).id;
 });
 afterAll(async()=>{if(prisma){await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await prisma.$disconnect();}if(root)await rm(root,{recursive:true,force:true});});
 const request=(id=targetId,options:RequestInit={})=>route(new Request('http://app.example.test/api/research-targets/'+id+'/terminal',{method:'POST',...options}),{params:Promise.resolve({id})});
 it('serializes concurrent creation/reconnect into one target workspace without modifying historical UUID sessions',async()=>{
  const legacy=await prisma.researchSession.create({data:{userId,targetId,workspaceId:randomUUID(),status:'READY',targetHost:'app.example.test',programName:'Legacy',scopeMarkdown:'Historical fixture'}});
  const [a,b]=await Promise.all([ensure(userId,targetId),ensure(userId,targetId)]);expect(a.session.id).toBe(b.session.id);expect(a.session.workspaceId).toBe('research_'+targetId);
  const duplicate={userId,targetId,consoleTargetId:targetId,workspaceId:randomUUID(),targetHost:'app.example.test',programName:'SQL fixture',scopeMarkdown:''};
  await expect(prisma.researchSession.create({data:duplicate})).rejects.toMatchObject({code:'P2002'});
  await expect(prisma.researchSession.create({data:{...duplicate,consoleTargetId:'another-target'}})).rejects.toThrow();
  expect(await prisma.researchSession.findUnique({where:{id:legacy.id}})).toEqual(legacy);
  await writeFile(join(root,a.session.workspaceId,'findings/notes.md'),'Operator notes retained');await ensure(userId,targetId);expect(await readFile(join(root,a.session.workspaceId,'findings/notes.md'),'utf8')).toBe('Operator notes retained');
  expect(await prisma.finding.count({where:{targetId}})).toBe(0);expect(await prisma.scanRun.count({where:{targetId}})).toBe(0);
 });
 it('issues a verified ticket bound to server-owned target/session; returns no app credentials/paths',async()=>{
  const result=await request();expect(result.status).toBe(200);const body=await result.json(),claims=verifyTerminalTicket(body.token,publicKey);
  expect(claims.targetId).toBe(targetId);expect(claims.userId).toBe(userId);expect(body.requiredUserAgent).toBe('Console-UA/1');expect(JSON.stringify(body)).not.toMatch(/DATABASE_URL|AUTH_SECRET|private.pem|workspacePath|command/);
 });
 it('rejects anonymous/foreign target, foreign origin and any browser body/command',async()=>{
  mocks.auth.mockResolvedValue(null);expect((await request()).status).toBe(401);mocks.auth.mockResolvedValue({user:{id:otherId}});expect((await request()).status).toBe(404);
  mocks.auth.mockResolvedValue({user:{id:userId}});expect((await request(targetId,{headers:{Origin:'http://foreign.example.test'}})).status).toBe(403);
  expect((await request(targetId,{body:JSON.stringify({command:'bash',workspace:'../other'})})).status).toBe(400);expect((await request('../x')).status).toBe(404);
 });
 it.each(['revoked','excluded','inactive','scope owner','program owner','policy changed'])('refuses active admission after %s',async reason=>{
  await ensure(userId,targetId);const t=await prisma.target.findUniqueOrThrow({where:{id:targetId}});
  if(reason==='revoked')await prisma.scope.update({where:{id:t.scopeId},data:{status:'REVOKED'}});
  if(reason==='excluded')await prisma.bountyProgram.update({where:{id:t.programId!},data:{outOfScope:['app.example.test']}});
  if(reason==='inactive')await prisma.target.update({where:{id:targetId},data:{active:false}});
  if(reason==='scope owner')await prisma.scope.update({where:{id:t.scopeId},data:{userId:otherId}});
  if(reason==='program owner')await prisma.bountyProgram.update({where:{id:t.programId!},data:{ownerId:otherId}});
  if(reason==='policy changed')await prisma.bountyProgram.update({where:{id:t.programId!},data:{requiredUserAgent:'New-UA/2'}});
  expect((await request()).status).not.toBe(200);
 });
 it('refuses a hostile existing target directory and never adopts another target workspace',async()=>{
  const outside=await mkdtemp(join(tmpdir(),'console-outside-'));try{await symlink(outside,join(root,'research_'+targetId));expect((await request()).status).toBe(409);expect(await prisma.researchSession.count({where:{consoleTargetId:targetId}})).toBe(0);}finally{await rm(outside,{recursive:true,force:true});}
 });
});
