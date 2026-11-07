import {describe,it,expect,vi,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({find:vi.fn(),provider:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{reconSummary:{findFirst:mocks.find}}}));
vi.mock('@/server/brain/client',()=>({BrainClient:mocks.provider}));
import {buildReconReportModel,type ReportFacts} from '@/lib/reconReportModel';
import {renderReconReportMarkdown} from '@/lib/reconReportMarkdown';
import {projectRunNarrative,runNarrativeInput} from '@/lib/reconRunNarrative';
import {validateReconReportV3} from '@/lib/reconReportV3';
import {readRunNarrative} from '@/server/recon/runNarrative';

export function evidenceFixture():ReportFacts {
 return {run:{id:'parent-fixture',status:'COMPLETED',outcome:'PARTIAL',createdAt:'2026-11-01T00:00:00Z',startedAt:null,finishedAt:'2026-11-01T00:01:00Z'},program:{companyName:'Report fixture',platform:null,requiredUserAgent:null,outOfScope:['excluded.fixture.test'],rulesOfEngagement:null,assessmentMode:'NOT_RECORDED'},authorizedAssets:['app.fixture.test'],authSurfaces:[],scans:[{id:'scan-fixture',scopeAssetId:'asset-fixture',host:'app.fixture.test',status:'COMPLETED',outcome:'PARTIAL',startedAt:null,finishedAt:null,requiredUserAgent:null,authenticatedContexts:0,plan:null,steps:[{name:'HTTP',state:'PARTIAL',reason:'Timeout',details:{capabilities:[{providersAttempted:[{provider:'httpx',state:'FAILED'}]}]}}],changeSet:{notObserved:['old']},toolVersions:null,artifactCount:14,artifacts:[
  {id:'dns',kind:'observation',value:{hostname:'app.fixture.test',type:'dns-address',addresses:['192.0.2.10']}},
  {id:'cname',kind:'hostname',value:{hostname:'excluded.fixture.test',origin:'app.fixture.test',relationship:'CNAME'}},
  {id:'tls',kind:'tls',value:{hostname:'app.fixture.test',validFrom:'2026-01-01',validTo:'2027-01-01',fingerprint:'AB:CD'}},
  {id:'port',kind:'port',value:{hostname:'app.fixture.test',port:8080,protocol:'tcp',state:'filtered'}},
  {id:'http',kind:'endpoint',value:{url:'https://app.fixture.test/api',method:'GET',statusCode:403,redirect:'/login'}},
  ...Array.from({length:7},(_,i)=>({id:'js'+i,kind:'url',value:{url:`https://app.fixture.test/js/${i}.js`}})),
  {id:'map',kind:'url',value:{url:'https://app.fixture.test/app.js.map'}},
  {id:'manifest',kind:'url',value:{url:'https://app.fixture.test/manifest.json'}},
 ].map(a=>({...a,scopeState:a.id==='cname'?'OUT_OF_SCOPE':'IN_SCOPE',verification:'OBSERVED',sources:[{tool:'fixture-tool',provider:'recorded-provider',sourceRef:'source-fixture',observedAt:'2026-11-01T00:00:00Z'}],firstSeenAt:'2026-11-01T00:00:00Z',lastSeenAt:'2026-11-01T00:00:01Z'}))}]};
}
function stored(facts:ReportFacts,text='Recorded observations require manual review.') {
 const input=runNarrativeInput(facts),alias=Object.entries(input.aliases).find(([,id])=>id==='http')![0];
 const payload={title:'Recon overview',attackSurfaceSummary:'Recorded evidence remains incomplete.',sections:[{category:'webSurface',entries:[{text,confidence:'observed',evidenceRefs:[alias]}]}],notableObservations:[],limitations:[],researchHandoff:[]};
 return {input,payload,report:validateReconReportV3(JSON.stringify(payload),input)};
}
afterEach(()=>vi.restoreAllMocks());
describe('Milestone4 deterministic report',()=>{
 it('renders persisted DNS addresses/CNAME without deriving record types or authorization',()=>{
  const f=evidenceFixture(),m=buildReconReportModel(f),dns=m.dnsRecords;
  expect(dns).toContainEqual({host:'app.fixture.test',recordType:null,value:'192.0.2.10',relationship:expect.stringContaining('captured Scope'),refs:['dns']});
  expect(dns.find(r=>r.recordType==='CNAME')).toMatchObject({value:'excluded.fixture.test',relationship:'Excluded (captured policy)'});
  expect(m.authorization.authorized).toEqual(['app.fixture.test']);expect(m.network[0]).toMatchObject({port:8080,state:'filtered'});
  expect(renderReconReportMarkdown(m)).not.toContain('| 443 |');expect(m.dnsRecords.some(r=>r.recordType==='A'||r.recordType==='AAAA')).toBe(false);
 });
 it('never transfers a service between TCP/UDP or an unrecorded protocol on the same port',()=>{
  const f=evidenceFixture();f.scans[0].artifacts=[{id:'tcp',kind:'port',value:{hostname:'app.fixture.test',port:53,protocol:'tcp',state:'filtered'}},{id:'udp',kind:'service',value:{hostname:'app.fixture.test',port:53,protocol:'udp',name:'dns'}},{id:'unknown',kind:'port',value:{hostname:'app.fixture.test',port:53}}];
  const rows=buildReconReportModel(f).network;expect(rows).toHaveLength(3);expect(rows.find(r=>r.protocol==='tcp')).toMatchObject({service:null,state:'filtered'});expect(rows.find(r=>r.protocol==='udp')).toMatchObject({service:'dns',state:null});expect(rows.find(r=>r.protocol===null)).toMatchObject({service:null,state:null});
 });
 it('shows recorded TLS aliases, bounded static categories and exact provenance',()=>{
  const f=evidenceFixture(),m=buildReconReportModel(f),md=renderReconReportMarkdown(m);
  expect(m.tls[0].properties).toContainEqual({name:'Valid from',value:'2026-01-01'});expect(m.tls[0].properties.some(p=>p.name==='Protocol'||p.name==='Cipher')).toBe(false);
  expect(m.staticAssets.find(s=>s.category==='JavaScript')).toMatchObject({count:7,truncated:true,samples:expect.any(Array)});expect(m.staticAssets.find(s=>s.category==='JavaScript')!.samples).toHaveLength(5);
  expect(md).toContain('Source maps');expect(md).toContain('Manifests');expect(md).toContain('source-fixture');expect(md).toContain('scan-fixture');expect(md).toContain('parent-fixture');expect(md).toContain('2026-11-01');expect(md).toContain('Not recorded');expect(md).toContain('filtered');
 });
 it('discloses missing evidence and per-host inventory truncation rather than negative findings',()=>{
  const f=evidenceFixture();f.scans[0].artifacts=[];const m=buildReconReportModel(f),md=renderReconReportMarkdown(m);
  expect(m.evidenceTruncated).toBe(true);expect(md).toContain('DNS evidence not included in the bounded report inventory');expect(md).toContain('TLS evidence not included in the bounded report inventory');expect(md).toContain('lower bounds');expect(md).not.toContain('NXDOMAIN observed');
 });
 it('escapes Markdown/HTML and redacts secrets in all new categories and provenance',()=>{
  const f=evidenceFixture();f.scans[0].artifacts[2].value.subject='<script>alert(1)</script>| *cert* Authorization: Bearer TLS_SECRET';f.scans[0].artifacts[0].sources=[{tool:'fixture',sourceRef:'password=SOURCE_SECRET'}];
  const md=renderReconReportMarkdown(buildReconReportModel(f));expect(md).not.toContain('<script>');expect(md).not.toContain('TLS_SECRET');expect(md).not.toContain('SOURCE_SECRET');expect(md).toContain('&lt;script&gt;');expect(md).toContain('\\|');
 });
});
describe('Milestone4 optional stored Settings-routed narrative',()=>{
 it('revalidates existing v3 and renders only a citation-backed application-written projection',()=>{
  const f=evidenceFixture(),m=buildReconReportModel(f),r=stored(f).report,result=projectRunNarrative(r,f,m);
  expect(result.state).toBe('AI_ASSISTED');expect(result.highlights[0].refs).toEqual(['http']);expect(result.highlights[0].text).toContain('https://app.fixture.test/api');expect(JSON.stringify(result)).not.toContain('Recorded observations require manual review');
 });
 it.each(['unknown.fixture.test','198.51.100.27','port 4444','service redis','service frobnicator','tool made-up-scanner','https://app.fixture.test/invented','confirmed vulnerability','completed successfully','removed','safe','persona administrator'])('rejects unsupported AI claim: %s',claim=>{
  const f=evidenceFixture(),m=buildReconReportModel(f),{report}=stored(f);report.narrative.webSurface[0].text=claim;
  expect(()=>projectRunNarrative(report,f,m)).toThrow();
 });
 it('compares JSON facts by value independently of stored object-key order',()=>{
  const f=evidenceFixture(),m=buildReconReportModel(f),r=stored(f).report;
  for(const section of r.factual.sections)for(const row of section.rows)row.details=Object.fromEntries(Object.entries(row.details).reverse());
  expect(projectRunNarrative(r,f,m).state).toBe('AI_ASSISTED');
 });
 it('rejects a model alias supplied in place of a persisted evidence identity',()=>{
  const f=evidenceFixture(),m=buildReconReportModel(f),{report,input}=stored(f);const alias=Object.entries(input.aliases).find(([,id])=>id==='http')![0];report.narrative.webSurface[0].evidenceRefs=[alias];
  expect(()=>projectRunNarrative(report,f,m)).toThrow();
 });
 it('rejects stale/foreign references, malformed schema and empty enhancement',()=>{
  const f=evidenceFixture(),m=buildReconReportModel(f),{report}=stored(f);
  report.narrative.webSurface[0].evidenceRefs=['foreign-id'];expect(()=>projectRunNarrative(report,f,m)).toThrow();
  const stale=stored(f).report;f.scans[0].artifacts.find(a=>a.id==='http')!.value.statusCode=500;expect(()=>projectRunNarrative(stale,f,buildReconReportModel(f))).toThrow();
  expect(projectRunNarrative({},f,m).state).toBe('UNAVAILABLE');const empty=stored(f).report;empty.narrative.webSurface=[];expect(projectRunNarrative(empty,f,m).state).toBe('UNAVAILABLE');
 });
 it.each(['disabled','not-configured','missing-auth','timeout','http-400','http-500','malformed-json','invalid-schema','rejected','empty'])('retains byte-identical deterministic facts on %s',async failure=>{
  const f=evidenceFixture(),m=buildReconReportModel(f),before=JSON.stringify(m);
  const report=stored(f).report;
  mocks.find.mockResolvedValue(['disabled','not-configured'].includes(failure)?null:{status:'READY',promptVersion:'recon-report/3',provider:'OPENROUTER',model:'saved-fixture-model',content:failure==='malformed-json'?'not JSON':failure==='invalid-schema'?{}:{...report,narrativeStatus:'FACTUAL_ONLY',narrativeFailure:failure}});
  const result=await readRunNarrative('owner',f,m);expect(result.state).not.toBe('AI_ASSISTED');expect(JSON.stringify(m)).toBe(before);expect(renderReconReportMarkdown(m,result)).toContain('DNS and Hosts');expect(renderReconReportMarkdown(m,result)).toContain('TLS Evidence');
 });
 it('cannot rewrite missing historical policy or insert model HTML through the enhancement',()=>{
  const f=evidenceFixture(),m=buildReconReportModel(f),r=stored(f).report;r.narrative.attackSurfaceSummary='User-Agent TODAY-UA. <script>MODEL_HTML</script>';
  const result=projectRunNarrative(r,f,m),md=renderReconReportMarkdown(m,result);expect(result.state).toBe('AI_ASSISTED');expect(md).not.toContain('TODAY-UA');expect(md).not.toContain('MODEL_HTML');expect(m.authorization.userAgent).toBeNull();
 });
 it('keeps the factual report when the optional synthesis store is unavailable',async()=>{
  const f=evidenceFixture(),m=buildReconReportModel(f);mocks.find.mockRejectedValueOnce(Error('PRIVATE_DATABASE_DETAIL'));const result=await readRunNarrative('owner',f,m);expect(result.state).toBe('UNAVAILABLE');expect(renderReconReportMarkdown(m,result)).toContain('DNS and Hosts');expect(JSON.stringify(result)).not.toContain('PRIVATE_DATABASE_DETAIL');
 });
 it('performs zero provider or scheduling calls for repeated live reads and exports',async()=>{
  const f=evidenceFixture(),m=buildReconReportModel(f);mocks.find.mockResolvedValue({status:'READY',promptVersion:'recon-report/3',provider:'OPENROUTER',model:'saved-fixture-model',content:stored(f).report});
  const net=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('Provider/network forbidden'));
  for(let i=0;i<10;i++){const result=await readRunNarrative('owner',f,m);expect(result.state).toBe('AI_ASSISTED');expect(result.model).toBe('saved-fixture-model');renderReconReportMarkdown(m,result);}
  expect(mocks.provider).not.toHaveBeenCalled();expect(net).not.toHaveBeenCalled();expect(mocks.find).toHaveBeenLastCalledWith(expect.objectContaining({where:expect.objectContaining({targetReconRunId:'parent-fixture',program:{ownerId:'owner'}})}));
 });
});
