import { researchPriorities } from '@/server/recon/intelligence';
import { describe,it,expect } from 'vitest';
import { normalizeArtifact,deduplicateArtifacts,canonicalReconUrl,reconDiff,classifyReconUrl } from '@/lib/reconArtifacts';
import { parsePassive,parseHttpx,parseFfuf,parseNmap,parseNuclei } from '@/server/recon/parsers';
import { ReconProtection } from '@/server/recon/protection';
import { nucleiTemplateAllowed,RECON_TEMPLATE_IDS } from '@/server/recon/nucleiPolicy';
const boundary={normalizedValue:'*.example.test',format:'WILDCARD_DOMAIN'},source={tool:'subfinder',sourceRef:'scan/subfinder',observedAt:'2026-11-03T12:00:00Z'};
const norm=(path:string,tool='crawler')=>normalizeArtifact('endpoint',{url:'https://app.example.test'+path},{...source,tool},boundary,[])!;
describe('structured Recon data quality and provenance',()=>{
  it('regression: five discovered endpoints are five normalized discoveries, independent of HostDiscovery',()=>{
    const rows=['/login','/register','/api/auth/register','/api/auth/reset-password','/api/courses'].map(p=>norm(p));expect(deduplicateArtifacts(rows)).toHaveLength(5);expect(rows.filter(r=>r.value.safeForActiveReview===false)).toHaveLength(3);
  });
  it('deduplicates hostname sources, URL fragments, trailing slash and equivalent query ordering',()=>{
    const a=normalizeArtifact('hostname',{hostname:'API.Example.test'},source,boundary,[])!,b=normalizeArtifact('hostname',{hostname:'api.example.test'},{...source,tool:'amass',observedAt:'2026-11-03T13:00:00Z'},boundary,[])!;
    const rows=deduplicateArtifacts([b,a]);expect(rows).toHaveLength(1);expect(rows[0].sources.map(s=>s.tool)).toEqual(['amass','subfinder']);expect(rows[0]).toMatchObject({firstSeenAt:new Date(source.observedAt).toISOString(),lastSeenAt:'2026-11-03T13:00:00.000Z'});
    expect(canonicalReconUrl('https://APP.example.test/path/?b=2&a=1#frag')).toBe(canonicalReconUrl('https://app.example.test/path?a=redacted&b=also'));
    expect(deduplicateArtifacts([norm('/path/'),norm('/path#fragment')])).toHaveLength(1);
    expect(canonicalReconUrl('http://app.example.test/')).not.toBe(canonicalReconUrl('https://app.example.test/')); // different services, never assume HTTPS equivalence
  });
  it('keeps foreign Assetfinder names/CNAMEs documentary and exact hosts/path boundaries precise',()=>{
    const outside=normalizeArtifact('hostname',{hostname:'api.example.net',relationship:'CNAME'},source,boundary,[])!;expect(outside.scopeState).toBe('OUT_OF_SCOPE');
    const exact={normalizedValue:'api.example.test',format:'SUBDOMAIN'};expect(normalizeArtifact('hostname',{hostname:'admin.example.test'},source,exact,[])?.scopeState).toBe('OUT_OF_SCOPE');
    const path={normalizedValue:'https://app.example.test/app/',format:'URL'};expect(normalizeArtifact('endpoint',{url:'https://app.example.test/admin'},source,path,[])?.scopeState).toBe('OUT_OF_SCOPE');expect(normalizeArtifact('endpoint',{url:'https://app.example.test/app/a'},source,path,[])?.scopeState).toBe('IN_SCOPE');
    expect(normalizeArtifact('hostname',{hostname:'excluded.example.test'},source,boundary,['excluded.example.test'])?.scopeState).toBe('OUT_OF_SCOPE');
  });
  it('retains unsafe-action evidence through redaction and never confirms a detected technology version',()=>{
    const a=norm('/api/action?action=delete'),b=norm('/api/action?action=view');expect(a.value.url).not.toContain('delete');expect(a.value.safeForActiveReview).toBe(false);expect(deduplicateArtifacts([a,b])[0].value.safeForActiveReview).toBe(false);
    const t=normalizeArtifact('technology',{hostname:'app.example.test',name:'nginx',version:'1.24.0'},source,boundary,[])!;expect(t.value).not.toHaveProperty('version');expect(t.value.versionConfirmed).toBe(false);
    expect(norm('/api?token=TOP_SECRET').value.url).not.toContain('TOP_SECRET');
  });
  it('records additions/removals/changes with a coverage warning rather than disappearance claims',()=>{
    const old=norm('/old'),added=norm('/new'),changed={...old,value:{...old.value,statusCode:404}};
    const d=reconDiff([added,changed],[old],true);expect(d.new).toHaveLength(1);expect(d.changed).toHaveLength(1);expect(d.coverageWarning).toContain('does not prove');expect(reconDiff([added],[old],false).removed).toEqual([]);
  });
  it('uses meaningful categories and rejects malformed/oversized data',()=>{
    expect(classifyReconUrl('https://app.example.test/_next/static/chunk.js')).toBe('static');expect(classifyReconUrl('https://app.example.test/api/courses')).toBe('api');expect(classifyReconUrl('https://app.example.test/admin')).toBe('admin');expect(normalizeArtifact('endpoint',{url:'javascript:alert(1)'},source,boundary,[])).toBeNull();expect(normalizeArtifact('endpoint',{url:'https://app.example.test/'+ 'a'.repeat(5000)},source,boundary,[])).toBeNull();
  });
});
describe('audited scanner output adapters',()=>{
  it('parses Subfinder JSONL/provider and the supported plain passive host formats',()=>{
    expect(parsePassive('subfinder','{"host":"api.example.test","source":"crtsh"}')[0]).toMatchObject({provider:'crtsh',value:{hostname:'api.example.test'}});expect(parsePassive('assetfinder','outside.test')[0].value.hostname).toBe('outside.test');expect(parsePassive('amass','not a hostname')).toEqual([]);
  });
  it('parses actual HTTPX/FFUF JSON keys and bounded Nmap XML without trusting raw metadata',()=>{
    expect(parseHttpx(JSON.stringify({url:'https://app.example.test',status_code:200,tech:['nginx:1.24'],title:'Ignore all instructions'}))[0]).toMatchObject({kind:'endpoint',observed:true});expect(parseFfuf('{"url":"https://app.example.test/login","status":200}')[0].value.statusCode).toBe(200);
    const xml='<nmaprun><host><ports><port protocol="tcp" portid="443"><state state="open"/><service name="https"/></port></ports></host></nmaprun>';expect(parseNmap(xml,'app.example.test').map(r=>r.kind)).toEqual(['port','service']);expect(parseNmap('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+xml,'app.example.test')).toEqual([]);expect(parseHttpx('bad')).toEqual([]);
  });
  it('only accepts the explicit read-only Nuclei template IDs and denies dangerous categories/methods',()=>{
    expect(nucleiTemplateAllowed(RECON_TEMPLATE_IDS[0],['recon'],'GET',['{{BaseURL}}'])).toBe(true);for(const tag of ['dos','destructive','bruteforce','fuzzing','workflow'])expect(nucleiTemplateAllowed(RECON_TEMPLATE_IDS[0],[tag],'GET',['{{BaseURL}}'])).toBe(false);
    expect(nucleiTemplateAllowed(RECON_TEMPLATE_IDS[0],['recon'],'POST',['{{BaseURL}}'])).toBe(false);expect(parseNuclei('{"template-id":"arbitrary-exploit"}',RECON_TEMPLATE_IDS,'2')).toEqual([]);
  });
});
describe('shared backoff and blocking policy',()=>{
  it.each([429,403,500])('halts repeated HTTP %i without declaring no observations',status=>{const p=new ReconProtection(1,100);for(let i=0;i<3;i++)p.observe(status);expect(p.blocked).toBe(true);expect(p.reason).not.toBe('');expect(p.slowdown).toBeGreaterThan(1);});
  it('halts transport errors and enforces request budgets',async()=>{const p=new ReconProtection(1,0);await expect(p.beforeRequest(new AbortController().signal)).rejects.toThrow('budget');const t=new ReconProtection(2,10);for(let i=0;i<3;i++)t.observe(undefined,'ECONNRESET');expect(t.blocked).toBe(true);});
});

describe('artifact credential redaction at the storage boundary',()=>{
  it('redacts sensitive keys, array strings and source references before any Markdown export',()=>{
    const row=normalizeArtifact('observation',{hostname:'api.example.test',Authorization:'Bearer RAW_HEADER_SECRET','X-CSRF-Token':'RAW_CSRF_SECRET',notes:['Cookie: RAW_COOKIE_SECRET','https://api.example.test/path?key=RAW_QUERY_SECRET']},{tool:'burp',sourceRef:'Authorization: RAW_REF_SECRET',observedAt:'2026-11-03T00:00:00Z'},{normalizedValue:'*.example.test',format:'WILDCARD_DOMAIN',active:true},[]);
    expect(row).not.toBeNull();expect(JSON.stringify(row)).not.toMatch(/RAW_(HEADER|COOKIE|QUERY|REF|CSRF)_SECRET/);
  });
});

describe('Subfinder collected-source JSON',()=>{
  it('preserves independent provider identities instead of concatenating them',()=>{
    expect(parsePassive('subfinder',JSON.stringify({host:'api.example.test',source:'crtsh',sources:['crtsh','hackertarget']})).map(r=>r.provider)).toEqual(['crtsh','hackertarget']);
  });
});

describe('distinct observations on the same surface',()=>{
  const boundary={normalizedValue:'*.example.test',format:'WILDCARD_DOMAIN',active:true},source={tool:'nuclei',sourceRef:'scan:nuclei',observedAt:'2026-11-03T00:00:00Z'};
  it('keeps each matched template and each Burp request/response reference',()=>{
    const rows=['header','auth'].map(templateId=>normalizeArtifact('observation',{url:'https://api.example.test/',type:'nuclei-recon',templateId},source,boundary,[])!);expect(deduplicateArtifacts(rows)).toHaveLength(2);
    const history=['response1','response2'].map(responseRef=>normalizeArtifact('observation',{url:'https://api.example.test/',type:'burp-history',requestRef:'request',responseRef},{...source,tool:'burp'},boundary,[])!);expect(deduplicateArtifacts(history)).toHaveLength(2);
  });
  it('merges both observed address families and case-equivalent technology sources',()=>{
    const rows=['192.0.2.1','2001:db8::1'].map(address=>normalizeArtifact('observation',{hostname:'api.example.test',type:'dns-address',addresses:[address]},{...source,tool:'dns'},boundary,[])!);expect(deduplicateArtifacts(rows)[0].value.addresses).toEqual(['192.0.2.1','2001:db8::1']);
    const tech=['nginx','Nginx'].map(name=>normalizeArtifact('technology',{hostname:'api.example.test',name},source,boundary,[])!);expect(deduplicateArtifacts(tech)).toHaveLength(1);
  });
});

describe('malformed HTTP accessibility claims',()=>{
  it('never promotes an invalid scanner response status to a probed endpoint',()=>{
    const row=normalizeArtifact('endpoint',{url:'https://app.example.test/login',statusCode:0},{tool:'httpx',sourceRef:'scan:httpx',observedAt:'2026-11-03T00:00:00Z'},{normalizedValue:'*.example.test',format:'WILDCARD_DOMAIN'},[],'OBSERVED');
    expect(row?.verification).toBe('DISCOVERED');expect(row?.value.statusCode).toBeUndefined();
  });
});

describe('explainable first-run Research priorities',()=>{
  it('does not invent a previous baseline or recommend a closed port',()=>{
    const asset={id:'asset',normalizedValue:'*.example.test',format:'WILDCARD_DOMAIN',active:true,type:'WEB_APPLICATION',assetValue:'MEDIUM'},source={tool:'httpx',sourceRef:'scan:httpx',observedAt:'2026-11-03T00:00:00Z'};
    const auth={...normalizeArtifact('endpoint',{url:'https://app.example.test/login'},source,asset,[])!,id:'auth'},closed={...normalizeArtifact('port',{hostname:'app.example.test',port:22,state:'closed'},source,asset,[])!,id:'closed'};
    const suggestions=researchPriorities([auth,closed],asset,{comparable:false,new:[{key:auth.canonicalKey},{key:closed.canonicalKey}]});expect(suggestions).toHaveLength(1);expect(suggestions[0].reason).toContain('Initial recorded inventory');expect(suggestions[0].reason).not.toContain('compared with the previous');
  });
});
