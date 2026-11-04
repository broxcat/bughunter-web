import { describe, it, expect } from 'vitest';
import { mkdtemp, lstat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureAssessmentSnapshot } from '@/lib/assessment';
import { createResearchBundle, researchAssessmentSnapshot, researchAuthorizationMatches, researchAuthorizationSnapshot, assertResearchTarget, writeResearchWorkspace } from '@/server/research/workspace';
import { consoleBundle, writeConsoleWorkspace } from '@/server/research/consoleWorkspace';
import { targetWorkspaceId } from '@/lib/research/terminal';
import { researchTarget, researchSession } from '../fixtures/research';
import { buildReconContext, type ReconRun } from '@/server/research/reconContext';

const source={id:'source-internal',label:'Internal source',kind:'GIT_REPOSITORY' as const,locator:'https://git.internal.test/team/application',reference:'release/approved',includePaths:['src/'],excludePaths:['vendor/'],updatedAt:'2026-11-04T00:00:00Z',active:true};
const captured=()=>({...researchAuthorizationSnapshot(researchTarget()),...captureAssessmentSnapshot({assessmentMode:'WHITE_BOX'},[source])});
describe('Research assessment context is metadata, not authorization',()=>{
  it('includes the immutable captured mode and sources across research inputs',()=>{
    const files=createResearchBundle(researchTarget(),null,[],{...researchSession,authorizationSnapshot:captured()});
    const policy=JSON.parse(files['assessment-policy.json']);
    expect(policy).toMatchObject({assessmentMode:'WHITE_BOX',contentAvailable:false,sourceAnalysisPerformed:false,sourceAuthorizationSeparate:true});
    expect(policy.authorizedSources[0]).toMatchObject({id:source.id,contentAvailable:false,evidenceOrigin:'SOURCE',locator:source.locator});
    expect(JSON.parse(files['target.json']).assessment).toMatchObject({assessmentMode:'WHITE_BOX'});
    expect(files['AGENTS.md']).toContain('## ASSESSMENT MODE');expect(files['AGENTS.md']).toContain('Captured assessment mode: WHITE_BOX');expect(files['AGENTS.md']).toContain('Do not invent code observations');expect(files['AGENTS.md']).toContain('Do not fetch registered source locators');expect(files['scope.md']).toContain('Source authorization does not expand network authorization');
  });
  it('does not treat internal source hostnames as concrete network targets',()=>{
    const target=researchTarget(),snapshot=captured();
    expect(researchAuthorizationMatches(snapshot,target)).toBe(true);
    expect(()=>assertResearchTarget({...target,host:'git.internal.test'},target.userId)).toThrow();
    expect(JSON.parse(createResearchBundle(target,null,[],{...researchSession,authorizationSnapshot:snapshot})['target.json']).host).toBe('app.example.test');
  });
  it('does not compare nested assessment arrays by reference or revoke on metadata drift',()=>{
    const target=researchTarget(),snapshot=JSON.parse(JSON.stringify(captured()));
    expect(researchAuthorizationMatches(snapshot,target)).toBe(true);
    snapshot.assessmentMode='BLACK_BOX';snapshot.authorizedSources=[{id:'different-source'}];
    expect(researchAuthorizationMatches(snapshot,target)).toBe(true);
    expect(researchAuthorizationMatches(snapshot,{...target,host:'other.example.test'})).toBe(false);
    const changed=researchTarget();changed.program!.requiredUserAgent='Different-Agent';expect(researchAuthorizationMatches(snapshot,changed)).toBe(false);
  });
  it('keeps historical missing assessment mode unknown instead of inferring current configuration',()=>{
    const historical=researchAuthorizationSnapshot(researchTarget());
    expect(researchAssessmentSnapshot(historical)).toMatchObject({assessmentMode:null,authorizedSources:[],sourceContentAvailable:false});
    expect(researchAuthorizationMatches(historical,researchTarget())).toBe(true);
    const files=createResearchBundle(researchTarget(),null,[],researchSession);
    expect(JSON.parse(files['assessment-policy.json']).assessmentMode).toBeNull();expect(files['scope.md']).toContain('Legacy / mode not captured');
  });
  it('states the black-box evidence boundary without denying access to existing workspace evidence',()=>{
    const snapshot={...researchAuthorizationSnapshot(researchTarget()),...captureAssessmentSnapshot({assessmentMode:'BLACK_BOX'})};
    const files=createResearchBundle(researchTarget(),null,[],{...researchSession,authorizationSnapshot:snapshot});
    expect(files['AGENTS.md']).toContain('Do not assume access to source code, internal architecture or private documentation');
    expect(files['AGENTS.md']).toContain('Use only supplied Recon/Research evidence');
    expect(files['AGENTS.md']).toContain('Only source material actually present in the workspace');
    expect(files['AGENTS.md']).not.toContain('read local paths');
  });
  it('bounds Recon handoff to captured mode/count and a reference instead of duplicating source metadata',()=>{
    const snapshot=captureAssessmentSnapshot({assessmentMode:'WHITE_BOX'},Array.from({length:100},(_,i)=>({...source,id:'source-'+i,includePaths:Array(100).fill('src/'+('x'.repeat(400)))})));
    const input={programId:'program',targetId:'target',scopeId:'scope',generatedAt:researchSession.createdAt.toISOString(),runs:[],inScope:()=>false,activeSuggestionsAllowed:false};
    const context=buildReconContext({...input,assessmentSnapshot:snapshot});
    expect(context.assessment).toEqual({assessmentMode:'WHITE_BOX',authorizedSourceCount:100,sourceContentAvailable:false,sourceAnalysisPerformed:false,assessmentPolicyFile:'assessment-policy.json'});
    expect(Buffer.byteLength(JSON.stringify(context.assessment))).toBeLessThan(512);expect(JSON.stringify(context)).not.toContain('git.internal.test');
  });
  it('uses the latest Recon capture only when no session capture was supplied, preserving historical unknown mode',()=>{
    const run:ReconRun={id:'latest',targetId:'target',status:'COMPLETED',outcome:'SUCCESS',createdAt:researchSession.createdAt,startedAt:null,finishedAt:null,reconCorpus:null,target:{host:'app.example.test'},discoveries:[],logs:[],assessmentModeSnapshot:'WHITE_BOX',assessmentSourcesSnapshot:captureAssessmentSnapshot({assessmentMode:'WHITE_BOX'},[source]).authorizedSources};
    const input={programId:'program',targetId:'target',scopeId:'scope',generatedAt:researchSession.createdAt.toISOString(),runs:[run],inScope:()=>false,activeSuggestionsAllowed:false};
    expect(buildReconContext(input).assessment).toMatchObject({assessmentMode:'WHITE_BOX',authorizedSourceCount:1});
    expect(buildReconContext({...input,assessmentSnapshot:captureAssessmentSnapshot({assessmentMode:'BLACK_BOX'})}).assessment).toMatchObject({assessmentMode:'BLACK_BOX',authorizedSourceCount:0});
    expect(buildReconContext({...input,runs:[{...run,assessmentModeSnapshot:undefined,assessmentSourcesSnapshot:undefined}]}).assessment).toMatchObject({assessmentMode:null,assessmentPolicyFile:null});
  });
  it('publishes the assessment policy read-only in both ZIP workspace and persistent console layouts',async()=>{
    const root=await mkdtemp(join(tmpdir(),'research-assessment-'));
    try{
      const session={...researchSession,authorizationSnapshot:captured()};
      const files=createResearchBundle(researchTarget(),null,[],session);await writeResearchWorkspace(root,session.workspaceId,files);
      expect((await lstat(join(root,session.workspaceId,'assessment-policy.json'))).mode&0o777).toBe(0o440);
      const consoleSession={...session,workspaceId:targetWorkspaceId('target')};const consoleFiles=consoleBundle(researchTarget(),null,[],consoleSession);
      await writeConsoleWorkspace(root,'target',consoleFiles);
      expect((await lstat(join(root,consoleSession.workspaceId,'assessment-policy.json'))).mode&0o777).toBe(0o440);
      expect(await readFile(join(root,consoleSession.workspaceId,'assessment-policy.json'),'utf8')).toBe(files['assessment-policy.json']);
      expect(consoleFiles['.agents/bughunter/AGENTS.md']).toContain('Captured assessment mode: WHITE_BOX');
      expect(JSON.parse(consoleFiles['.agents/bughunter/target.json']).assessment.authorizedSources[0].locator).toBe(source.locator);
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
