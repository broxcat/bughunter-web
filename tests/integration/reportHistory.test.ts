import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({auth:vi.fn(),target:vi.fn(),reports:vi.fn(),program:vi.fn()}));
vi.mock("@/lib/auth",()=>({auth:mocks.auth}));
vi.mock("@/lib/prisma",()=>({prisma:{bountyProgram:{findFirst:mocks.program},target:{findFirst:mocks.target},report:{findMany:mocks.reports}}}));
import { GET } from "@/app/api/reports/route";
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({user:{id:"owner"}});mocks.target.mockResolvedValue({id:"host"});mocks.reports.mockResolvedValue([])});
describe("owned report history",()=>{
  it("requires authentication",async()=>{mocks.auth.mockResolvedValue(null);expect((await GET(new NextRequest("http://localhost/api/reports"))).status).toBe(401)});
  it("rejects another user's host before reading reports",async()=>{mocks.target.mockResolvedValue(null);expect((await GET(new NextRequest("http://localhost/api/reports?targetId=foreign"))).status).toBe(404);expect(mocks.reports).not.toHaveBeenCalled()});
  it("filters history by both user and selected host",async()=>{await GET(new NextRequest("http://localhost/api/reports?targetId=host"));expect(mocks.target).toHaveBeenCalledWith({where:{id:"host",userId:"owner"},select:{id:true}});expect(mocks.reports).toHaveBeenCalledWith({where:{userId:"owner",targetId:"host"},orderBy:{createdAt:"desc"}})});
  it('supports owned Program Reports without confusing technical Target identities',async()=>{mocks.program.mockResolvedValue({id:'program'});mocks.reports.mockResolvedValue([{id:'report',title:'Historical report',markdown:null,items:[{finding:{targetId:'host-a'}},{finding:{targetId:'host-b'}}]}]);const r=await GET(new NextRequest('http://localhost/api/reports?programId=program'));expect(r.status).toBe(200);expect((await r.json())[0].evidenceTargetIds).toEqual(['host-a','host-b']);expect(mocks.reports.mock.calls[0][0].where).toMatchObject({userId:'owner',items:{some:{finding:{target:{programId:'program',userId:'owner'}}}}});});
  it('rejects foreign Program history',async()=>{mocks.program.mockResolvedValue(null);expect((await GET(new NextRequest('http://localhost/api/reports?programId=foreign'))).status).toBe(404);expect(mocks.reports).not.toHaveBeenCalled();});
  it("retains the existing whole-user API when no host filter is supplied",async()=>{await GET(new NextRequest("http://localhost/api/reports"));expect(mocks.reports.mock.calls[0][0].where).toEqual({userId:"owner"})});
});
