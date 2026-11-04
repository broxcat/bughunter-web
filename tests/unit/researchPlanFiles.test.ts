import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { publishResearchPlanFiles, researchPlanInitialFiles, researchPlanReference, verifyResearchPlanFiles, RESEARCH_PLAN_JSON_BYTES, type ResearchPlanPublication } from '@/server/research/planFiles';
import { consoleBundle, writeConsoleWorkspace } from '@/server/research/consoleWorkspace';
import { createResearchBundle, newWorkspaceId, writeResearchWorkspace, readResearchZip } from '@/server/research/workspace';
import { reconJson } from '@/server/research/reconContext';
import { reconDeliveryPrompt } from '@/lib/research/reconDelivery';
import { researchSession, researchTarget } from '../fixtures/research';

const publication=(id='plan-A'):ResearchPlanPublication=>{
  const jsonText=reconJson({id,version:'research-plan/1',sourceAnalysisPerformed:false,items:[{id:'item-'+id,objective:'Review observed evidence manually.'}]});
  return{id,jsonText,contentSha256:createHash('sha256').update(jsonText).digest('hex'),markdownText:`# Research Plan\n\nPlan: ${id}\nAdvisory only. No source analysis was performed.\n`};
};
let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'research-plan-files-'));});
afterEach(async()=>{await rm(root,{force:true,recursive:true});await rm(root+'-link',{force:true});});
describe('read-only Research plan inputs and explicit version delivery',()=>{
  it('publishes the same initial JSON and Markdown to persistent consoles and immutable ZIP exports',async()=>{
    const plan=publication(),reference=researchPlanReference(plan),inputs=researchPlanInitialFiles(plan);
    const consoleFiles=consoleBundle(researchTarget(),null,[],{...researchSession,workspaceId:'research_target'},plan);
    const zipFiles=createResearchBundle(researchTarget(),null,[],researchSession,false,plan);
    for(const[name,contents]of Object.entries(inputs)){expect(consoleFiles[name]).toBe(contents);expect(zipFiles[name]).toBe(contents);}
    const consoleRoot=join(root,'console'),zipRoot=join(root,'zip'),id=newWorkspaceId();
    await writeConsoleWorkspace(consoleRoot,'target',consoleFiles);const zip=await writeResearchWorkspace(zipRoot,id,zipFiles);
    for(const[base,workspace]of [[consoleRoot,'research_target'],[zipRoot,id]])for(const name of Object.keys(inputs))expect((await lstat(join(base,workspace,name))).mode&0o777).toBe(0o440);
    expect((await lstat(join(zipRoot,id,'research'))).mode&0o1000).toBe(0o1000);
    expect((await lstat(join(zipRoot,id,'research/notes.md'))).mode&0o020).toBe(0o020);
    const archived=JSON.parse(execFileSync('python3',['-c','import io,sys,json,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({n:{"content":z.read(n).decode(),"mode":(z.getinfo(n).external_attr>>16)&511} for n in z.namelist()}))'],{input:await readResearchZip(zipRoot,id,zip.exportSha256)}).toString());
    expect(archived['bughunter-research/research/plan.json']).toEqual({content:plan.jsonText,mode:0o440});
    await verifyResearchPlanFiles(consoleRoot,'research_target',reference);
  });
  it('adds explicit version files idempotently and never rewrites the initial plan or earlier versions',async()=>{
    const initial=publication(),next=publication('plan-B');await writeConsoleWorkspace(root,'target',consoleBundle(researchTarget(),null,[],{...researchSession,workspaceId:'research_target'},initial));
    const before=await readFile(join(root,'research_target/research/plan.json'),'utf8');
    const reference=await publishResearchPlanFiles(root,'research_target',next);await publishResearchPlanFiles(root,'research_target',next);
    await verifyResearchPlanFiles(root,'research_target',reference);
    expect(await readFile(join(root,'research_target',reference.jsonPath),'utf8')).toBe(next.jsonText);
    expect(await readFile(join(root,'research_target/research/plan.json'),'utf8')).toBe(before);
    await verifyResearchPlanFiles(root,'research_target',researchPlanReference(initial));
    const prompt=reconDeliveryPrompt('a'.repeat(64));expect(prompt).toContain('same snapshot is available to Codex and Claude');expect(prompt).toContain('exact versioned local plan');expect(prompt).toContain('read-only advisory');
  });
  it('can explicitly add a version to a historical console without retrofitting its initial aliases',async()=>{
    await writeConsoleWorkspace(root,'target',consoleBundle(researchTarget(),null,[],{...researchSession,workspaceId:'research_target'}));
    const reference=await publishResearchPlanFiles(root,'research_target',publication());await verifyResearchPlanFiles(root,'research_target',reference);
    await expect(lstat(join(root,'research_target/research/plan.json'))).rejects.toMatchObject({code:'ENOENT'});
    await expect(lstat(join(root,'research_target/research/plan.md'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('rejects forged digests, paths, oversized plans, writable files, hardlinks and tampered Markdown',async()=>{
    const plan=publication();expect(()=>researchPlanReference({...plan,contentSha256:'a'.repeat(64)})).toThrow('integrity');
    const large='x'.repeat(RESEARCH_PLAN_JSON_BYTES+1);expect(()=>researchPlanReference({...plan,jsonText:large,contentSha256:createHash('sha256').update(large).digest('hex')})).toThrow('limit');
    await writeConsoleWorkspace(root,'target',consoleBundle(researchTarget(),null,[],{...researchSession,workspaceId:'research_target'},plan));
    const reference=researchPlanReference(plan),path=join(root,'research_target',reference.jsonPath),md=join(root,'research_target',reference.markdownPath);
    await expect(verifyResearchPlanFiles(root,'research_target',{...reference,jsonPath:'../scope.md'})).rejects.toThrow('reference');
    await chmod(path,0o640);await expect(publishResearchPlanFiles(root,'research_target',plan)).rejects.toThrow('integrity');await chmod(path,0o440);
    await link(path,path+'.link');await expect(verifyResearchPlanFiles(root,'research_target',reference)).rejects.toThrow('integrity');await unlink(path+'.link');
    await chmod(md,0o640);await writeFile(md,'Unsupported replacement.');await chmod(md,0o440);await expect(verifyResearchPlanFiles(root,'research_target',reference)).rejects.toThrow('integrity');
  });
  it('never follows a replaced input directory, file, or configured-root symlink',async()=>{
    const plan=publication();await writeConsoleWorkspace(root,'target',consoleBundle(researchTarget(),null,[],{...researchSession,workspaceId:'research_target'},plan));
    const path=join(root,'research_target',researchPlanReference(plan).jsonPath);await unlink(path);await symlink('/etc/passwd',path);
    await expect(publishResearchPlanFiles(root,'research_target',plan)).rejects.toThrow();
    await rm(join(root,'research_target/research'),{recursive:true});const outside=join(root,'outside');await mkdir(outside);await symlink(outside,join(root,'research_target/research'));
    await expect(publishResearchPlanFiles(root,'research_target',plan)).rejects.toThrow();
    await symlink(root,root+'-link');await expect(publishResearchPlanFiles(root+'-link','research_target',plan)).rejects.toThrow();
  });
});
