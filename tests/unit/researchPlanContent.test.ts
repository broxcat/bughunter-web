import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import ResearchPlan,{ResearchPlanContent} from '@/components/ResearchPlan';
import type {ResearchPlanView} from '@/lib/researchPlanView';

const plan=():ResearchPlanView=>({id:'plan',targetId:'target',programId:'program',scopeAssetId:'asset',scanRunId:'scan',sourceFingerprint:'f'.repeat(64),methodologyVersion:'research-plan/1',assessmentMode:'WHITE_BOX',status:'CURRENT',createdAt:'2026-11-04T12:00:00Z',supersededAt:null,limitations:['Only recorded read-only observations are available.'],notes:['Review existing negative controls before repeating a test.'],authorizedSourceCount:2,sourceAnalysisPerformed:false,items:[{id:'item',stableKey:'auth:profile',category:'AUTHENTICATION',priority:'HIGH',title:'Review the observed authentication boundary',objective:'Compare observed account visibility manually.',rationale:'Two recorded contexts differ for the same endpoint.',methodology:'Use independent baseline and negative controls within authorized scope.',surfaceRefs:[{url:'https://app.example.test/profile',method:'GET',requestable:false}],evidenceRefs:['ReconSurfaceObservation:observed'],contextRefs:[{contextKey:'opaque-context',label:'Authenticated context 1',persona:'User'}],runtimeSignals:[],sourceSignals:[],sourceEvidenceRefs:[],status:'READY',score:50,evidenceStrength:10,isNew:true,hypotheses:[{id:'existing',externalId:'H-001',title:'Previously tested boundary',status:'REJECTED'}],findings:[{id:'finding',title:'Existing reviewed observation',reviewStatus:'CANDIDATE'}]}]});
const render=(value=plan())=>renderToStaticMarkup(createElement(ResearchPlanContent,{plan:value}));

describe('Research plan presentation',()=>{
  it('shows objectives, reasons, observed surfaces, evidence and existing rejected work',()=>{
    const html=render();for(const value of ['Objective:','Why:','Method:','Observed surface','Evidence and provenance','ReconSurfaceObservation:observed','Previously tested boundary','Retained rejected hypothesis','Existing findings','Visibility differences require manual validation'])expect(html).toContain(value);
  });
  it('distinguishes source metadata and declared personas from analyzed or verified behavior',()=>{
    const html=render();expect(html).toContain('2 historical source references');expect(html).toContain('White-box mode is retired');expect(html).toContain('source content has not been analyzed');expect(html).toContain('operator-declared');expect(html).toContain('An objective is not a vulnerability or a completed test');
  });
  it('keeps target-controlled HTML and URLs as text, with no active target link or raw JSON dump',()=>{
    const value=plan();value.items[0].title='<script>change_permissions()</script>';value.items[0].surfaceRefs[0].url='https://app.example.test/\"><img src=x onerror=expand_scope()>';
    const html=render(value);expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).not.toContain('href=');expect(html).not.toContain('<pre');
  });
  it('counts actionable objectives only and keeps excluded work explicitly excluded',()=>{
    const value=plan();value.items.push({...value.items[0],id:'excluded',status:'NOT_APPLICABLE_BY_PROGRAM'});const html=render(value);expect(html).toContain('1 objectives');expect(html).toContain('1 high priority');expect(html).toContain('Excluded by program');expect(html).not.toContain('2 objectives');
  });
  it('does not invent an assessment mode or investigation when historical context is absent',()=>{
    const value=plan();value.assessmentMode=null;value.items=[];const html=render(value);expect(html).toContain('Assessment mode not captured');expect(html).toContain('No supported investigation objectives yet');expect(html).not.toContain('Black-box');
  });
  it('has no checklist, status mutation, automatic hypothesis action or exploitation controls',()=>{
    const html=render();expect(html).not.toContain('<input');expect(html).not.toContain('<button');expect(html).not.toContain('Create hypothesis');expect(html).not.toContain('Run test');
  });
  it('keeps list rows lazy and compact instead of loading a plan for every console',()=>{
    const html=renderToStaticMarkup(createElement(ResearchPlan,{targetId:'target',compact:true}));expect(html).toContain('View plan');expect(html).not.toContain('Loading plan');expect(html).not.toContain('Research plan details');expect(html).not.toContain('objectives');
  });
  it('shows the batched server summary before opening a plan without a client request',()=>{
    const html=renderToStaticMarkup(createElement(ResearchPlan,{targetId:'target',compact:true,initialSummary:{objectives:6,high:2,reconCurrent:true}}));expect(html).toContain('6');expect(html).toContain('objectives');expect(html).toContain('2');expect(html).toContain('high priority');expect(html).toContain('Recon current');expect(html).not.toContain('Loading plan');
  });
});
