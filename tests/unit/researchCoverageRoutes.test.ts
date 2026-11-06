import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),state:vi.fn(),record:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
vi.mock('@/server/research/coverage',()=>({researchCoverageState:mocks.state,recordResearchCoverage:mocks.record}));
import {GET,POST} from '@/app/api/research-coverage/[targetId]/route';
const context={params:Promise.resolve({targetId:'target'})};
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{id:'owner'}});});
describe('Coverage HTTP boundary',()=>{
 it('requires authentication before reading Target memory',async()=>{mocks.auth.mockResolvedValue(null);expect((await GET(new Request('http://localhost/api/research-coverage/target'),context)).status).toBe(401);expect(mocks.state).not.toHaveBeenCalled();});
 it('rejects foreign-origin mutation before accessing coverage',async()=>{const r=await POST(new Request('http://localhost/api/research-coverage/target',{method:'POST',headers:{origin:'https://foreign.test'},body:'{}'}),context);expect(r.status).toBe(403);expect(mocks.record).not.toHaveBeenCalled();});
 it('bounds metadata and rejects invalid JSON without persisting anything',async()=>{
  for(const body of ['not json','x'.repeat(32769)]){const r=await POST(new Request('http://localhost/api/research-coverage/target',{method:'POST',body}),context);expect([400,413]).toContain(r.status);}expect(mocks.record).not.toHaveBeenCalled();
 });
 it('keeps internal errors and provider/DB details out of responses',async()=>{mocks.state.mockRejectedValue(new Error('PRIVATE_PASSWORD database details'));const r=await GET(new Request('http://localhost/api/research-coverage/target'),context);expect(r.status).toBe(503);expect(await r.text()).not.toContain('PRIVATE_');expect(r.headers.get('Cache-Control')).toContain('no-store');});
});
