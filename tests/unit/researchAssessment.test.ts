import { describe, it, expect } from 'vitest';
import { captureAssessmentSnapshot } from '@/lib/assessment';
import { researchAssessmentSnapshot, researchAuthorizationMatches, researchAuthorizationSnapshot, assertResearchTarget } from '@/server/research/workspace';
import { researchTarget, researchSession } from '../fixtures/research';
import { buildReconContext, type ReconRun } from '@/server/research/reconContext';

const source={id:'source-internal',label:'Internal source',kind:'GIT_REPOSITORY' as const,locator:'https://git.internal.test/team/application',reference:'release/approved',includePaths:['src/'],excludePaths:['vendor/'],updatedAt:'2026-11-04T00:00:00Z',active:true};
const captured=()=>({...researchAuthorizationSnapshot(researchTarget()),...captureAssessmentSnapshot({assessmentMode:'WHITE_BOX'},[source])});
describe('Research assessment context is metadata, not authorization',()=>{
  it('keeps historical white-box assessment metadata readable',()=>{
    const snapshot={...captured(),assessmentMode:'WHITE_BOX',authorizedSources:[source]};
    expect(researchAssessmentSnapshot(snapshot).assessmentMode).toBe('WHITE_BOX');
  });
  it('does not treat internal source hostnames as concrete network targets',()=>{
    const target=researchTarget(),snapshot=captured();
    expect(researchAuthorizationMatches(snapshot,target)).toBe(true);
    expect(()=>assertResearchTarget({...target,host:'git.internal.test'},target.userId)).toThrow();
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
  });
  it('bounds Recon handoff to captured mode/count and a reference instead of duplicating source metadata',()=>{
    const snapshot=captureAssessmentSnapshot({assessmentMode:'WHITE_BOX'},Array.from({length:100},(_,i)=>({...source,id:'source-'+i,includePaths:Array(100).fill('src/'+('x'.repeat(400)))})));
    const input={programId:'program',targetId:'target',scopeId:'scope',generatedAt:researchSession.createdAt.toISOString(),runs:[],inScope:()=>false,activeSuggestionsAllowed:false};
    const context=buildReconContext({...input,assessmentSnapshot:snapshot});
    expect(context.assessment).toEqual({assessmentMode:'BLACK_BOX',authorizedSourceCount:0,sourceContentAvailable:false,sourceAnalysisPerformed:false,assessmentPolicyFile:'assessment-policy.json'});
    expect(Buffer.byteLength(JSON.stringify(context.assessment))).toBeLessThan(512);expect(JSON.stringify(context)).not.toContain('git.internal.test');
  });
  it('uses the latest Recon capture only when no session capture was supplied, preserving historical unknown mode',()=>{
    const run:ReconRun={id:'latest',targetId:'target',status:'COMPLETED',outcome:'SUCCESS',createdAt:researchSession.createdAt,startedAt:null,finishedAt:null,reconCorpus:null,target:{host:'app.example.test'},discoveries:[],logs:[],assessmentModeSnapshot:'WHITE_BOX',assessmentSourcesSnapshot:captureAssessmentSnapshot({assessmentMode:'WHITE_BOX'},[source]).authorizedSources};
    const input={programId:'program',targetId:'target',scopeId:'scope',generatedAt:researchSession.createdAt.toISOString(),runs:[run],inScope:()=>false,activeSuggestionsAllowed:false};
    expect(buildReconContext(input).assessment).toMatchObject({assessmentMode:'WHITE_BOX',authorizedSourceCount:0});
    expect(buildReconContext({...input,assessmentSnapshot:captureAssessmentSnapshot({assessmentMode:'BLACK_BOX'})}).assessment).toMatchObject({assessmentMode:'BLACK_BOX',authorizedSourceCount:0});
    expect(buildReconContext({...input,runs:[{...run,assessmentModeSnapshot:undefined,assessmentSourcesSnapshot:undefined}]}).assessment).toMatchObject({assessmentMode:null,assessmentPolicyFile:null});
  });
});
