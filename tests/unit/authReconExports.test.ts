import { describe,expect,it } from 'vitest';
import { deriveSurfaceVisibility,type SafeAuthSurface,type SurfaceObservation } from '@/lib/authenticatedRecon';
import { exportAuthSurfaces,authSurfaceEvidence,AUTH_EXPORT_BYTES } from '@/server/recon/authExport';
import { deriveAssetGraph } from '@/lib/reconGraph';
import { buildReconContext,compactReconContext,reconJson,type ReconRun,RECON_SUMMARY_BYTES } from '@/server/research/reconContext';
import { createReconReportV3Input,modelInputForReconReportV3,fallbackReconReportV3 } from '@/lib/reconReportV3';
import { reportInput,reportBudget } from '@/lib/reconReport';
const at='2026-11-04T00:00:00Z',key='GET:'+('a'.repeat(64));
function fixture():SafeAuthSurface{
  const contexts:SafeAuthSurface['contexts']=[{contextKey:'ANONYMOUS',mode:'ANONYMOUS',label:'Anonymous',state:'MAPPED'},{contextKey:'CTX_A',mode:'AUTHENTICATED',label:'Alice Customer',persona:'alice@example.test',state:'MAPPED',purpose:'ACCOUNT_A'},{contextKey:'CTX_B',mode:'AUTHENTICATED',label:'Bob Customer',persona:'ADMIN',state:'MAPPED',purpose:'ACCOUNT_B'}];
  const observation=(contextKey:string,statusCode:number,responseClass:string,id:string):SurfaceObservation=>({id,contextKey,contextType:contextKey==='ANONYMOUS'?'ANONYMOUS':'AUTHENTICATED',canonicalKey:key,url:'https://app.example.test/dashboard',method:'GET',statusCode,contentType:'text/html',redirect:null,redirectPattern:null,responseClass,observedAt:at,source:'credential:PRIVATE_CREDENTIAL_RECORD'});
  const observations=[observation('ANONYMOUS',401,'DENIED','obs-anon'),observation('CTX_A',200,'CONTENT','obs-a'),observation('CTX_B',403,'DENIED','obs-b')];
  return{scanRunId:'scan-one',legacy:false,contexts,observations,surfaceVisibility:deriveSurfaceVisibility(contexts,observations),totals:{public:0,authenticatedOnly:1,sharedAuthenticated:0,contextDifferentials:1,observations:3},warnings:[]};
}
const run=(authentication:SafeAuthSurface):ReconRun=>({id:authentication.scanRunId,targetId:'target',status:'COMPLETED',outcome:'SUCCESS',createdAt:new Date(at),startedAt:new Date(at),finishedAt:new Date(at),reconCorpus:null,target:{host:'app.example.test'},discoveries:[],logs:[],artifacts:[],authentication});
describe('private authentication contexts to bounded Recon intelligence',()=>{
  it('exports opaque labels and explicit fields, never credential records, PII or responses',()=>{
    const raw=fixture();Object.assign(raw.contexts[1],{credentialId:'PRIVATE_ID',username:'PRIVATE_USERNAME',cookiesCipher:'PRIVATE_CIPHER'});Object.assign(raw.observations[1],{body:'PRIVATE_BODY',headers:{Authorization:'PRIVATE_HEADER'},bodyHash:'PRIVATE_HASH',bodyLength:100});
    const [safe]=exportAuthSurfaces([raw]),text=JSON.stringify(safe);
    for(const privateValue of ['Alice','Bob','alice@','PRIVATE_ID','PRIVATE_USERNAME','PRIVATE_CIPHER','PRIVATE_BODY','PRIVATE_HEADER','PRIVATE_HASH','PRIVATE_CREDENTIAL_RECORD'])expect(text).not.toContain(privateValue);
    expect(safe.contexts[1].label).toBe('Authenticated context 1');expect(safe.contexts[1].persona).toBe('Operator-declared persona (label withheld)');expect(safe.contexts[2].persona).toBe('ADMIN');expect(safe.totals.contextDifferentials).toBe(1);
    expect(text).toContain('does not demonstrate broken authorization');expect(safe.observations[0]).not.toHaveProperty('bodyLength');
  });
  it('never merges two different private object identities merely because redaction gives them the same URL pattern',()=>{
    const raw=fixture();raw.observations=raw.observations.filter(row=>row.contextKey!=='ANONYMOUS').map((row,index)=>({...row,canonicalKey:'GET:'+(index?'b':'a').repeat(64),url:'https://app.example.test/orders/[id]',urlRedacted:true,responseClass:index?'DENIED':'CONTENT',statusCode:index?403:200}));
    const [safe]=exportAuthSurfaces([raw]);expect(safe.surfaceVisibility).toHaveLength(2);expect(safe.totals.contextDifferentials).toBe(0);expect(safe.surfaceVisibility.every(item=>!item.classifications.includes('AUTHENTICATED_ONLY'))).toBe(true);
    expect(authSurfaceEvidence([safe]).every(row=>(row.value as {safeForActiveReview:boolean}).safeForActiveReview===false)).toBe(true);
  });
  it('does not call missing historical context anonymous or infer missing probes as denial',()=>{
    const legacy={...fixture(),legacy:true},[safe]=exportAuthSurfaces([legacy]);expect(safe.contexts).toEqual([]);expect(safe.observations).toEqual([]);expect(safe.surfaceVisibility).toEqual([]);expect(safe.warnings.join(' ')).toContain('unknown, not anonymous');
    const partial=fixture();partial.observations=partial.observations.filter(row=>row.contextKey==='CTX_A');const [result]=exportAuthSurfaces([partial]);expect(result.totals.authenticatedOnly).toBe(0);expect(result.totals.contextDifferentials).toBe(0);expect(result.surfaceVisibility[0].visibility.find(row=>row.contextKey==='CTX_B')?.outcome).toBe('NOT_OBSERVED_IN_CONTEXT');
  });
  it('keeps original observation references and per-context statuses in Research without overriding a global HTTP status',()=>{
    const raw=fixture(),context=buildReconContext({programId:'program',scopeId:'scope',targetId:'target',generatedAt:at,runs:[run(raw)],inScope:value=>value.includes('app.example.test'),activeSuggestionsAllowed:false});
    expect(context.endpoints).toHaveLength(1);expect(context.endpoints[0].contextObservations?.map(row=>row.statusCode).sort()).toEqual([200,401,403]);expect(context.endpoints[0].statusCode).toBeUndefined();
    expect(context.endpoints[0].references).toContain('ReconSurfaceObservation:obs-a');expect(reconJson(context)).not.toContain('Alice');expect(reconJson(context)).not.toContain('credential:');
    expect(context.assetGraph?.edges.filter(edge=>edge.relation==='OBSERVED_IN_CONTEXT')).toHaveLength(3);expect(context.assetGraph?.authorizationGranted).toBe(false);
  });
  it('adds only actual context observations to the graph, without permission edges or account labels',()=>{
    const raw=fixture(),graph=deriveAssetGraph([],{nodes:30,edges:30},exportAuthSurfaces([raw]));expect(graph.nodes.filter(node=>node.type==='AUTH_CONTEXT')).toHaveLength(3);expect(graph.edges.every(edge=>edge.relation==='OBSERVED_IN_CONTEXT'&&edge.evidenceRefs[0].startsWith('ReconSurfaceObservation:'))).toBe(true);expect(graph.nodes.filter(node=>node.type==='AUTH_CONTEXT').every(node=>!node.inScope)).toBe(true);expect(JSON.stringify(graph)).not.toMatch(/Alice|Bob|credential:/);
    raw.observations=raw.observations.map(row=>({...row,responseClass:'UNAVAILABLE',statusCode:null}));expect(deriveAssetGraph([],{nodes:30,edges:30},exportAuthSurfaces([raw])).edges).toEqual([]);
  });
  it('feeds safe contextual evidence through the existing fact/alias report contract, retaining source-analysis limits',()=>{
    const surfaces=exportAuthSurfaces([fixture()]),evidence=authSurfaceEvidence(surfaces),source=reportInput({},evidence,reportBudget(32768));
    const input=createReconReportV3Input(source,evidence,{assessmentMode:'WHITE_BOX',authorizedSourceCount:0,sourceContentAvailable:false,sourceAnalysisPerformed:false,networkAuthorizationSource:'ScopeAsset',sourceAuthorizationSeparate:true},surfaces);
    const text=JSON.stringify(modelInputForReconReportV3(input));expect(text).toContain('Authenticated context 1');expect(text).toContain('contextKey');expect(text).not.toMatch(/Alice|Bob|credential:|PRIVATE_/);
    const report=fallbackReconReportV3(input);expect(report.authenticatedRecon?.[0].totals.authenticatedOnly).toBe(1);expect(report.assessmentContext?.sourceAnalysisPerformed).toBe(false);expect(report.factual.sections.flatMap(section=>section.rows).some(row=>row.details.contextMode==='AUTHENTICATED')).toBe(true);
  });
  it('bounds exports and Research summaries deterministically with explicit truncation',()=>{
    const source=fixture(),many=Array.from({length:30},(_,index)=>({...source,scanRunId:'scan-'+String(index).padStart(3,'0'),observations:Array.from({length:90},(_,n)=>({...source.observations[n%3],id:`obs-${index}-${n}`,canonicalKey:'GET:'+String(n).padStart(64,'0'),url:'https://app.example.test/api/surface/'+n}))}));
    const a=exportAuthSurfaces(many),b=exportAuthSurfaces([...many].reverse());expect(a).toEqual(b);expect(Buffer.byteLength(JSON.stringify(a))).toBeLessThanOrEqual(AUTH_EXPORT_BYTES);expect(a.some(surface=>surface.truncated)).toBe(true);
    const context=buildReconContext({programId:'program',scopeId:'scope',targetId:'target',generatedAt:at,runs:many.map(run),inScope:()=>true,activeSuggestionsAllowed:false}),summary=compactReconContext(context);expect(Buffer.byteLength(reconJson(summary))).toBeLessThanOrEqual(RECON_SUMMARY_BYTES);expect(summary.truncated).toBe(true);
  });
});
