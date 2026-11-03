import { describe,it,expect } from 'vitest';
import { buildReconPlan,reconUrlAllowed,rankReconHost,RECON_CAPACITY } from '@/lib/reconPlanner';
import { detectScopeAsset } from '@/lib/scopeAssets';
const plan=(value:string,type:string,assetValue:string,active=true)=>buildReconPlan({id:'asset',...detectScopeAsset(value),type,assetValue,active:true},{active,exclusions:[]});
describe('deterministic Format × Type × Value planner',()=>{
  it.each([
    ['*.example.test','WILDCARD','LOW','LIGHT',true,1],['*.example.test','WILDCARD','CRITICAL','DEEP',true,8],
    ['app.example.test','WEB_APPLICATION','MEDIUM','STANDARD',false,1],['app.example.test','WEB_APPLICATION','CRITICAL','DEEP',false,1],
    ['api.example.test','API','MEDIUM','STANDARD',false,1],['api.example.test','API','HIGH','DEEP',false,1],
    ['https://app.example.test/app/','WEB_APPLICATION','LOW','LIGHT',false,1],['https://app.example.test/app/','WEB_APPLICATION','CRITICAL','DEEP',false,1],
    ['internal','OTHER','MEDIUM','STANDARD',false,1],
  ])('%s / %s / %s selects %s with bounded enrichment',(value,type,level,depth,wildcard,max)=>{
    const p=plan(value as string,type as string,level as string);expect(p.depth).toBe(depth);expect(p.limits.enrichHosts).toBe(max);expect(p.stages.find(s=>s.name==='Passive discovery')!.enabled).toBe(wildcard);
    expect(p.limits.rps).toBeGreaterThan(0);expect(p.limits.rps*RECON_CAPACITY.globalAssets).toBeLessThanOrEqual(RECON_CAPACITY.maxHttpRps);expect(p.limits.maxDurationMs).toBeLessThanOrEqual(1800000);
    expect(p.activityMode).toBe(value==='internal'?'PASSIVE':'ACTIVE');expect(p.rationale.length).toBeGreaterThanOrEqual(4);
  });
  it('separates passive/active traffic from light/deep depth and never derives authorization from Critical',()=>{
    const p=plan('*.example.test','WILDCARD','CRITICAL',false);expect(p).toMatchObject({activityMode:'PASSIVE',depth:'DEEP'});expect(reconUrlAllowed(p,'https://api.example.test/')).toBe(false);
    expect(plan('https://app.example.test/app','WEB_APPLICATION','LOW')).toMatchObject({activityMode:'ACTIVE',depth:'LIGHT'});
    expect(plan('https://app.example.test/delete','WEB_APPLICATION','CRITICAL').activityMode).toBe('PASSIVE');
  });
  it('gives a Critical wildcard a larger budget than a Critical exact URL without widening either boundary',()=>{
    const w=plan('*.example.test','WILDCARD','CRITICAL'),u=plan('https://app.example.test:8443/app/','WEB_APPLICATION','CRITICAL');expect(w.limits.maxRequests).toBeGreaterThan(u.limits.maxRequests);expect(w.limits.maxHosts).toBeGreaterThan(u.limits.maxHosts);
    expect(reconUrlAllowed(w,'https://api.example.net/')).toBe(false);expect(reconUrlAllowed(w,'https://example.test/')).toBe(false);expect(reconUrlAllowed(u,'https://app.example.test:8443/app/users')).toBe(true);
    for(const url of ['https://admin.example.test/','https://app.example.test:8443/admin','https://app.example.test/app','https://app.example.test:8443/app/%2e%2e/admin'])expect(reconUrlAllowed(u,url)).toBe(false);
    w.authorization.exclusions=['excluded.example.test'];expect(reconUrlAllowed(w,'https://excluded.example.test/')).toBe(false);
    expect(u.stages.find(s=>s.name==='Ports / services')?.enabled).toBe(false);
  });
  it('uses API profiles and deterministic host ranking independently of input order',()=>{
    expect(plan('api.example.test','API','HIGH').ffufProfile).toBe('API_DEEP');expect(plan('app.example.test','WEB_APPLICATION','MEDIUM').ffufProfile).toBe('WEB_STANDARD');
    const hosts=['static.example.test','admin.example.test','api.example.test'].map(h=>rankReconHost(h,{alive:true}));const sort=(rows:typeof hosts)=>rows.sort((a,b)=>b.score-a.score||a.host.localeCompare(b.host));expect(sort([...hosts])).toEqual(sort([...hosts].reverse()));expect(sort(hosts)[0].host).not.toBe('static.example.test');
  });
});
