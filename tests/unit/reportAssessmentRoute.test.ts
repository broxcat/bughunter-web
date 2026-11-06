import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn(),findings:vi.fn(),create:vi.fn(),oob:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
vi.mock('@/lib/prisma',()=>{const db={finding:{findMany:mocks.findings},report:{create:mocks.create},$queryRaw:vi.fn()};return{prisma:{...db,$transaction:(fn:(tx:typeof db)=>unknown)=>fn(db)}};});
vi.mock('@/lib/oobHits',()=>({loadOobHitsByToken:mocks.oob}));
import { POST } from '@/app/api/reports/route';
const finding=(id='finding')=>({id,targetId:'target',title:'Confirmed observation',reviewStatus:'CONFIRMED',oobToken:null});
const request=(ids=['finding'],extra={})=>new NextRequest('http://app.example.test/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Captured assessment report',platform:'GENERIC',findingIds:ids,...extra})});
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({user:{id:'owner'}});mocks.oob.mockResolvedValue(new Map());mocks.create.mockImplementation(async(args)=>({id:'report',...args.data}));});
describe('Report captured assessment provenance (mocked database, no lifecycle changes)',()=>{
  it('uses the finding ScanRun snapshot and ignores a request-supplied current-mode override',async()=>{
    mocks.findings.mockResolvedValue([{...finding(),scanRun:{assessmentModeSnapshot:'BLACK_BOX'},researchPromotion:null}]);
    const response=await POST(request(['finding'],{assessmentMode:'WHITE_BOX'}));expect(response.status).toBe(201);
    const saved=await response.json();expect(saved.markdown).toContain('Assessment mode: Black-box');expect(saved.markdown).not.toContain('Assessment mode: White-box');expect(saved.markdown).toContain('Recon ScanRun snapshot');
    expect(mocks.findings.mock.calls[0][0]).toMatchObject({where:{id:{in:['finding']},target:{userId:'owner'}},include:{scanRun:{select:{assessmentModeSnapshot:true}},researchPromotion:{select:{hypothesis:{select:{session:{select:{authorizationSnapshot:true}}}}}}}});
  });
  it('uses the real Research session declaration over the earlier Recon mode without exporting sources',async()=>{
    mocks.findings.mockResolvedValue([{...finding(),scanRun:{assessmentModeSnapshot:'BLACK_BOX'},researchPromotion:{hypothesis:{session:{authorizationSnapshot:{assessmentMode:'WHITE_BOX',authorizedSources:[{label:'PRIVATE_LABEL',locator:'https://git.example.test/PRIVATE_SOURCE'}]}}}}}]);
    const saved=await(await POST(request())).json();expect(saved.markdown).toContain('Assessment mode: White-box');expect(saved.markdown).toContain('Research session authorization snapshot');expect(saved.markdown).not.toContain('PRIVATE_');expect(saved.markdown).not.toContain('git.example.test');
  });
  it('keeps a promoted historical session without a captured mode unknown',async()=>{
    mocks.findings.mockResolvedValue([{...finding(),scanRun:{assessmentModeSnapshot:'WHITE_BOX'},researchPromotion:{hypothesis:{session:{authorizationSnapshot:{targetId:'target'}}}}}]);
    const saved=await(await POST(request())).json();expect(saved.markdown).toContain('Assessment mode: Legacy / mode not captured');expect(saved.markdown).not.toContain('Assessment mode: White-box');
  });
  it('renders mixed finding modes from captured provenance while preserving the requested finding order',async()=>{
    mocks.findings.mockResolvedValue([{...finding('white'),title:'White finding',scanRun:{assessmentModeSnapshot:'WHITE_BOX'}},{...finding('black'),title:'Black finding',scanRun:{assessmentModeSnapshot:'BLACK_BOX'}}]);
    const saved=await(await POST(request(['black','white']))).json();expect(saved.markdown).toContain('Assessment mode: Mixed captured modes');expect(saved.markdown.indexOf('Black finding')).toBeLessThan(saved.markdown.indexOf('White finding'));
  });
  it('preserves the confirmed-finding gate before creating a report',async()=>{
    mocks.findings.mockResolvedValue([{...finding(),reviewStatus:'REJECTED',scanRun:{assessmentModeSnapshot:'WHITE_BOX'}}]);
    expect((await POST(request())).status).toBe(400);expect(mocks.create).not.toHaveBeenCalled();
  });
});
