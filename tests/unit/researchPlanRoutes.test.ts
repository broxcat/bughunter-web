import {beforeEach,describe,expect,it,vi} from 'vitest';
import {ResearchError} from '@/server/research/workspace';
const mocks=vi.hoisted(()=>({auth:vi.fn(),current:vi.fn(),details:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
vi.mock('@/server/research/plans',()=>({researchPlanState:mocks.current,researchPlanDetails:mocks.details}));

describe('Research plan read-only routes',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{id:'owner'}});mocks.current.mockResolvedValue({plan:null,history:[],sessionPlanId:null,newPlanAvailable:false,reconCurrent:false,configurationChanged:false});mocks.details.mockResolvedValue({id:'plan'});});
  it('passes authenticated ownership to the service and disables caching for current/detail views',async()=>{
    const {GET:current}=await import('@/app/api/research-plans/current/route');const {GET:detail}=await import('@/app/api/research-plans/[id]/route');
    const response=await current(new Request('http://localhost/api/research-plans/current?targetId=target'));expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(mocks.current).toHaveBeenCalledWith('owner','target');
    const selected=await detail(new Request('http://localhost'),{params:Promise.resolve({id:'plan'})});expect(selected.status).toBe(200);expect(selected.headers.get('Cache-Control')).toBe('private, no-store');expect(mocks.details).toHaveBeenCalledWith('owner','plan');
  });
  it('rejects unauthenticated and malformed selections before reading private plans',async()=>{
    const {GET}=await import('@/app/api/research-plans/current/route');mocks.auth.mockResolvedValueOnce(null);expect((await GET(new Request('http://localhost?targetId=target'))).status).toBe(401);
    for(const query of ['','?targetId=../foreign','?targetId=https://target.test'])expect((await GET(new Request('http://localhost'+query))).status).toBe(400);expect(mocks.current).not.toHaveBeenCalled();
  });
  it('preserves safe not-found ownership errors and never emits database error details',async()=>{
    const {GET}=await import('@/app/api/research-plans/[id]/route');mocks.details.mockRejectedValueOnce(new ResearchError('Plan not found',404));expect((await GET(new Request('http://localhost'),{params:Promise.resolve({id:'foreign'})})).status).toBe(404);
    mocks.details.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_INTERNALS'));const response=await GET(new Request('http://localhost'),{params:Promise.resolve({id:'plan'})});expect(response.status).toBe(503);expect(await response.text()).not.toContain('PRIVATE_DATABASE_INTERNALS');
  });
});
