import { beforeEach,describe,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({asset:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{scopeAsset:{findUnique:mocks.asset}}}));
import { assertLiveAsset } from '@/server/recon/assetPipeline';
import { withTargetExecution } from '@/server/execution';
const context={targetId:'target',host:'app.example.test',requiredUserAgent:'Fixture/1',qualifying:[],nonQualifying:[],scopeAsset:{id:'asset',programId:'program',originalValue:'*.example.test',normalizedValue:'*.example.test',format:'WILDCARD_DOMAIN',type:'WILDCARD',assetValue:'HIGH',active:true}};
let asset:object;
beforeEach(()=>{asset={...context.scopeAsset,program:{outOfScope:[],deletingAt:null},executionTarget:{scope:{status:'APPROVED'}}};mocks.asset.mockImplementation(async()=>asset);});
describe('live authorization before every adaptive Recon scanner/request',()=>{
  it('allows only the selected authorized host, preserving the wildcard parent',async()=>{await expect(withTargetExecution(context,assertLiveAsset)).resolves.toMatchObject({id:'asset'});await expect(withTargetExecution({...context,host:'outside.test'},assertLiveAsset)).rejects.toThrow('outside');});
  it.each([{active:false},{program:{outOfScope:[],deletingAt:new Date()}},{executionTarget:{scope:{status:'REVOKED'}}},{normalizedValue:'*.neighbour.test'}])('fails closed when current authorization changes: %j',async change=>{asset={...asset,...change};await expect(withTargetExecution(context,assertLiveAsset)).rejects.toThrow('authorization changed');});
  it('applies newly added exclusions before a child process or HTTP request',async()=>{asset={...asset,program:{outOfScope:['app.example.test'],deletingAt:null}};await expect(withTargetExecution(context,assertLiveAsset)).rejects.toThrow('outside current asset scope');});
});
