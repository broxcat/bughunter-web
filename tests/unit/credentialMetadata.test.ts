import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { credentialMetadataPatchSchema,credentialMetadataSchema } from '@/lib/credentialMetadata';

const mocks=vi.hoisted(()=>({auth:vi.fn(),target:vi.fn(),find:vi.fn(),list:vi.fn(),create:vi.fn(),update:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
vi.mock('@/lib/prisma',()=>({prisma:{target:{findFirst:mocks.target},targetCredential:{findFirst:mocks.find,findMany:mocks.list,create:mocks.create,update:mocks.update}}}));
const target={id:'owned',host:'app.example.test',scopeAsset:{normalizedValue:'https://app.example.test:8443/app/',format:'URL',active:true},discoveredFromAsset:null};
const row={id:'session',targetId:'owned',label:'Test account',mode:'COOKIES',purpose:'ACCOUNT_A',persona:null,reconEnabled:false,ownedObjectUrl:'https://app.example.test:8443/app/object/1',cookiesCipher:'encrypted-only',headerCipher:null,emailCipher:null,loginUrl:null,sessionStatus:'VALID',sessionCheckedAt:new Date('2026-11-01T12:00:00Z'),sessionExpiresAt:new Date('2099-11-01T12:20:00Z'),sessionRefreshedAt:null,validationUrl:'https://app.example.test:8443/app/api/me',sessionIdentityHash:'identity-hash-must-stay-private',createdAt:new Date('2026-11-01T12:00:00Z')};
const params={params:Promise.resolve({id:'owned'})};
const request=(body:unknown,origin='http://localhost')=>new Request('http://localhost/api/targets/owned/credentials',{method:'PATCH',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});

describe('Recon credential metadata',()=>{
  afterEach(()=>vi.unstubAllEnvs());
  beforeEach(()=>{vi.stubEnv('AUTH_URL','http://localhost');vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{id:'operator'}});mocks.target.mockResolvedValue(target);mocks.find.mockResolvedValue(row);mocks.list.mockResolvedValue([row]);mocks.update.mockImplementation(async({data})=>({...row,...data}));});
  it('defaults new credentials to explicit Recon opt-out and normalizes only operator persona text',()=>{
    expect(credentialMetadataSchema.parse({})).toMatchObject({purpose:'OTHER',reconEnabled:false});
    expect(credentialMetadataSchema.parse({persona:'  Manager  '})).toMatchObject({persona:'Manager'});
    expect(credentialMetadataSchema.parse({persona:'   '})).toMatchObject({persona:null});
    for(const persona of ['Manager\r\nHeader: bad','User\u0000', 'x'.repeat(81)])expect(credentialMetadataSchema.safeParse({persona}).success).toBe(false);
  });
  it('PATCH has no creation defaults and does not accept credential material',()=>{
    expect(credentialMetadataPatchSchema.parse({persona:'User',cookiesCipher:'replace'})).toEqual({persona:'User'});
    expect(credentialMetadataPatchSchema.parse({reconEnabled:true})).toEqual({reconEnabled:true});
  });
  it('only changes requested fields, preserving account purpose, object reference and encrypted material',async()=>{
    const {PATCH}=await import('@/app/api/targets/[id]/credentials/route');
    const result=await PATCH(request({credentialId:row.id,persona:' Manager ',reconEnabled:true,cookiesCipher:'replace'}),params);
    expect(result.status).toBe(200);expect(mocks.update.mock.calls[0][0].data).toEqual({persona:'Manager',reconEnabled:true});
    const body=await result.json();expect(body.credential).toMatchObject({purpose:'ACCOUNT_A',ownedObjectUrl:row.ownedObjectUrl,persona:'Manager',reconEnabled:true});
    for(const hidden of ['cookiesCipher','headerCipher','sessionCookiesCipher','validationUrl','sessionIdentityHash','loginUrl'])expect(body.credential).not.toHaveProperty(hidden);
    expect(JSON.stringify(body)).not.toContain(row.sessionIdentityHash);
  });
  it('retains exact URL port and path authorization when editing owned object references',async()=>{
    const {PATCH}=await import('@/app/api/targets/[id]/credentials/route');
    expect((await PATCH(request({credentialId:row.id,ownedObjectUrl:'https://app.example.test:8443/app/object/2'}),params)).status).toBe(200);
    for(const value of ['https://app.example.test:8443/admin','https://app.example.test/app/object/2','http://app.example.test:8443/app/object/2','https://sibling.example.test:8443/app/object/2'])expect((await PATCH(request({credentialId:row.id,ownedObjectUrl:value}),params)).status).toBe(400);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('also enforces a discovered host parent boundary and rejects revoked references',async()=>{
    const {PATCH}=await import('@/app/api/targets/[id]/credentials/route');
    mocks.target.mockResolvedValue({...target,scopeAsset:null,discoveredFromAsset:target.scopeAsset});
    expect((await PATCH(request({credentialId:row.id,ownedObjectUrl:'https://app.example.test:8443/app/profile'}),params)).status).toBe(200);
    expect((await PATCH(request({credentialId:row.id,ownedObjectUrl:'https://app.example.test:8443/admin'}),params)).status).toBe(400);
    mocks.target.mockResolvedValue({...target,scopeAsset:null,discoveredFromAsset:{normalizedValue:'*.example.test',format:'WILDCARD_DOMAIN',active:false}});
    expect((await PATCH(request({credentialId:row.id,ownedObjectUrl:'https://app.example.test/profile'}),params)).status).toBe(400);
    expect((await PATCH(request({credentialId:row.id,reconEnabled:false}),params)).status).toBe(200);
  });
  it('exposes computed session dates and safe metadata without private validation evidence',async()=>{
    const {GET}=await import('@/app/api/targets/[id]/credentials/route');const response=await GET(new Request('http://localhost'),params);expect(response.status).toBe(200);
    const {credentials}=await response.json();expect(credentials[0]).toMatchObject({reconEnabled:false,persona:null,sessionStatus:'EXPIRED',sessionVerifiedAt:row.sessionCheckedAt.toISOString(),sessionExpiresAt:row.sessionExpiresAt.toISOString()});
    expect(JSON.stringify(credentials)).not.toContain(row.validationUrl);expect(JSON.stringify(credentials)).not.toContain(row.sessionIdentityHash);expect(JSON.stringify(credentials)).not.toContain(row.cookiesCipher);
  });
  it('rejects missing metadata, foreign owners and cross-origin browser writes',async()=>{
    const {PATCH}=await import('@/app/api/targets/[id]/credentials/route');expect((await PATCH(request({credentialId:row.id}),params)).status).toBe(400);
    expect((await PATCH(request({credentialId:row.id,reconEnabled:true},'https://foreign.example'),params)).status).toBe(403);
    mocks.target.mockResolvedValueOnce(null);expect((await PATCH(request({credentialId:row.id,reconEnabled:true}),params)).status).toBe(404);
    mocks.find.mockResolvedValueOnce(null);expect((await PATCH(request({credentialId:'foreign',reconEnabled:true}),params)).status).toBe(404);expect(mocks.update).not.toHaveBeenCalled();
  });
});
