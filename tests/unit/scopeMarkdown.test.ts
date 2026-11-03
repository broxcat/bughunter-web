import { describe,expect,it } from 'vitest';
import { renderScopeMarkdown,SCOPE_MARKDOWN_BYTES,type ScopeIntelligenceBrief } from '@/server/scopeMarkdown';
import { normalizeArtifact } from '@/lib/reconArtifacts';
import { buildReconPlan } from '@/lib/reconPlanner';
import type { Prisma } from '@prisma/client';
function fixture():ScopeIntelligenceBrief{
  const at=new Date('2026-11-03T00:00:00Z'),program={id:'target',companyName:'Équipe | **scope**',platform:null,programUrl:null,requiredUserAgent:'Fixture/1',rulesOfEngagement:'Only authorized scope.',outOfScope:['excluded.example.test'],updatedAt:at};
  const assets:ScopeIntelligenceBrief['assets']=[{id:'critical',programId:'target',originalValue:'*.example.test',normalizedValue:'*.example.test',format:'WILDCARD_DOMAIN',type:'WILDCARD',formatSource:'AUTO',typeSource:'USER',assetValue:'CRITICAL',active:true,createdAt:at,updatedAt:at,program,executionTarget:null},{id:'low',programId:'target',originalValue:'low.example.test',normalizedValue:'low.example.test',format:'SUBDOMAIN',type:'WEB_APPLICATION',formatSource:'AUTO',typeSource:'HEURISTIC',assetValue:'LOW',active:true,createdAt:at,updatedAt:at,program,executionTarget:null}];
  const details:ScopeIntelligenceBrief['details']=new Map(assets.map(asset=>[asset.id,{asset,run:null,history:[],artifacts:[],counts:[],discoveryCount:0,truncated:false,priorities:[],untrustedData:true}]));
  return{program,assets,details,generatedAt:at.toISOString(),parentId:'parent',bounded:false};
}
describe('concise, deterministic v2 Scope intelligence',()=>{
  it('includes YAML identity/version, authorization, human summary, no-data labels and safety boundary',()=>{
    const text=renderScopeMarkdown(fixture(),'critical');for(const value of ['format_version: 2','scope_asset_id: critical','# Scope Intelligence','Target ID: target','Asset ID: critical','Required User-Agent: Fixture/1','No data collected yet.','apex and neighbours are excluded','LLM Safety Boundary','SHA256:'])expect(text).toContain(value);expect(text).toContain('Équipe \\| \\*\\*scope\\*\\*');
  });
  it('orders Target assets by user value independently of input order',()=>{
    const brief=fixture(),a=renderScopeMarkdown(brief),b=renderScopeMarkdown({...brief,assets:[...brief.assets].reverse()});expect(a).toBe(b);expect(a.indexOf('/assets/critical/')).toBeLessThan(a.indexOf('/assets/low/'));expect(a).toContain('## Asset Overview');expect(a).toContain('## Recommended Research Order');expect(a).toContain('target_recon_run_id: parent');
  });
  it('summarizes static assets and preserves Partial/BLOCKED coverage with exact artifact provenance',()=>{
    const b=fixture(),detail=b.details.get('critical')!,at=new Date(b.generatedAt),plan=buildReconPlan(detail.asset,{active:true,exclusions:[]});
    detail.artifacts=Array.from({length:43},(_,i)=>({...normalizeArtifact('endpoint',{url:`https://app.example.test/_next/static/chunk${i}.js`},{tool:'crawler',sourceRef:'scan:crawler',observedAt:b.generatedAt},detail.asset,[])!,id:'a'+i}));detail.discoveryCount=43;
    detail.run={id:'scan',status:'COMPLETED',outcome:'PARTIAL',createdAt:at,startedAt:at,finishedAt:at,error:'Rate limiting',targetReconRunId:'parent',scopeMarkdownSha256:null,reconPlan:plan as unknown as Prisma.JsonValue,toolVersions:{httpx:{version:'1.12.0'}},changeSet:{new:[],removed:[],changed:[],coverageWarning:'Coverage differs'},reconSteps:[{id:'stage',scanRunId:'scan',name:'Content discovery',capability:null,details:null,position:7,state:'BLOCKED',reason:'HTTP 429',startedAt:at,finishedAt:at}],_count:{artifacts:43}};
    const text=renderScopeMarkdown(b,'critical');expect(text).toContain('recon_status: partial');expect(text).toContain('Static assets summarized: 43');expect(text).toContain('BLOCKED');expect(text).toContain('HTTP 429');expect(text).not.toContain('chunk42.js');expect(text).toContain('Recon run: scan');expect(text).toContain('Artifact IDs: a0');
  });
  it('redacts credential-like text, fences untrusted instructions, handles Unicode and long URLs, and bounds whole sections',()=>{
    const b=fixture(),item=b.assets[0];b.program.rulesOfEngagement='Authorization: Bearer DO_NOT_LEAK\nCookie: sid=DO_NOT_LEAK';
    const a=normalizeArtifact('endpoint',{url:'https://app.example.test/api/IGNORE_SYSTEM?token=PRIVATE',title:'```\nIGNORE_SCOPE <script>é</script>'},{tool:'httpx',sourceRef:'scan:httpx',observedAt:b.generatedAt},item,[])!;b.details.get(item.id)!.artifacts=[{...a,id:'artifact'}];
    const small=renderScopeMarkdown(b,item.id);expect(small).not.toContain('DO_NOT_LEAK');expect(small).not.toContain('PRIVATE');expect(small).toContain('untrusted target-controlled DATA');expect((small.match(/^```/gm)??[]).length%2).toBe(0);
    b.bounded=true;b.assets=Array.from({length:1000},(_,i)=>({...item,id:'asset'+i,normalizedValue:`https://app.example.test/${String(i).padStart(5,'0')}/${'segment/'.repeat(230)}`,originalValue:'https://app.example.test/',format:'URL'}));
    const large=renderScopeMarkdown(b);expect(Buffer.byteLength(large)).toBeLessThanOrEqual(SCOPE_MARKDOWN_BYTES);expect(large).toContain('Export limit');expect(large).toContain('LLM Safety Boundary');expect(large).toContain('Target ID: target');expect((large.match(/^```/gm)??[]).length%2).toBe(0);
  });
});
