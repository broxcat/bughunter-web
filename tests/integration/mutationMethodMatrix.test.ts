/// <reference types="vite/client" />
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
const db=process.env.TEST_DATABASE_URL,schema='methods_'+randomUUID().replaceAll('-','');
if(db){const u=new URL(db);u.searchParams.set('schema',schema);process.env.DATABASE_URL=u.toString();}
// Reuse the checked-in inventory, including delegated retired methods. This
// audit intentionally does not invent PUT or DELETE for immutable resources.
const inventory=readFileSync('docs/post-v1-route-inventory.md','utf8');
const imports=import.meta.glob('../../src/app/api/**/route.ts');
const rows=[...inventory.matchAll(/^\| `(\/api\/[^`]+)`.*?`(src\/app\/api\/[^`]+)`/gm)].flatMap(([,path,source])=>{
 const text=readFileSync(source,'utf8');
 const methods=[...text.matchAll(/export (?:async function|const) (POST|PATCH|PUT|DELETE)\b/g),...text.matchAll(/\bas (POST|PATCH|PUT|DELETE)\b/g)].map(m=>m[1]);
 return [...new Set(methods)].map(method=>({path,source,method,retired:text.includes('retired as')}));
}).filter(r=>!r.path.startsWith('/api/auth/')&&r.path!=='/api/register');
let p:typeof import('@/lib/prisma').prisma,userId:string;
const context={params:Promise.resolve(Object.fromEntries(['id','targetId','assetId','hostId','sourceId','hypothesisId','evidenceId'].map(k=>[k,'missing0000000000000000000'])))};
const call=async(row:typeof rows[number],data:string,origin?:string)=>{
 const mod=await imports['../../'+row.source]() as Record<string,(req:Request,ctx:typeof context)=>Promise<Response>>;
 const path=row.path.replace(/\[[^\]]+\]/g,'missing0000000000000000000');
 return mod[row.method](new NextRequest('http://app.example.test'+path,{method:row.method,headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:data}),context);
};
(db?describe:describe.skip)('Inventory mutating-method admission',()=>{
 beforeAll(async()=>{vi.stubEnv('AUTH_URL','http://app.example.test');execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});({prisma:p}=await import('@/lib/prisma'));userId=(await p.user.create({data:{email:randomUUID()+'@example.test'}})).id;},30000);
 afterAll(async()=>{vi.unstubAllEnvs();if(p){await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await p.$disconnect();}});
 for(const row of rows){
  it(`${row.method} ${row.path}: anonymous`,async()=>{mocks.auth.mockResolvedValue(null);const r=await call(row,'{}');expect(r.status).toBe(401);expect(r.headers.get('location')).toBeNull();});
  if(row.path.startsWith('/api/internal/'))continue;
  it(`${row.method} ${row.path}: explicit foreign Origin`,async()=>{mocks.auth.mockResolvedValue({user:{id:userId}});const r=await call(row,'{}','http://untrusted.example.test');expect(r.status).toBe(row.retired?410:403);});
  it(`${row.method} ${row.path}: missing resource and malformed JSON`,async()=>{mocks.auth.mockResolvedValue({user:{id:userId}});const r=await call(row,'{');const idempotent=row.method==='DELETE'&&['/api/programs/[id]','/api/research-targets/[id]/console'].includes(row.path);expect(idempotent?[200]:[400,404,410]).toContain(r.status);if(idempotent){expect(await r.json()).toEqual({deleted:true});expect((await call(row,'{')).status).toBe(200);}expect(r.headers.get('location')).toBeNull();});
 }
 it('tracks actual method totals separately from handler totals',()=>{expect(rows.length).toBeGreaterThan(46);expect(rows.some(r=>r.method==='PUT')).toBe(false);});
});
