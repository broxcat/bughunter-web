import { afterEach, beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),view:vi.fn(),schedule:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
vi.mock('@/server/recon/summaries',()=>({summaryView:mocks.view,scheduleReconSummary:mocks.schedule}));
import {summaryRoute} from '@/server/recon/summaryRoute';
const call=(body?:string,origin='http://app.example.test')=>summaryRoute(new Request('http://app.example.test/api/programs/program/summary',{method:'POST',...(body!==undefined?{body}:{}),headers:{Origin:origin}}),Promise.resolve({id:'program'}));
beforeEach(()=>{vi.stubEnv('AUTH_URL','http://app.example.test');mocks.auth.mockResolvedValue({user:{id:'owner'}});mocks.view.mockReset().mockResolvedValue({summary:null});mocks.schedule.mockReset().mockResolvedValue(undefined);});
it.each(['{','true','{"regenerate":"yes"}','{"command":"ignored"}'])('rejects invalid synthesis input without scheduling: %s',async body=>{expect((await call(body)).status).toBe(400);expect(mocks.schedule).not.toHaveBeenCalled();});
it('bounds synthesis input before scheduling',async()=>{expect((await call(' '.repeat(513))).status).toBe(413);expect(mocks.schedule).not.toHaveBeenCalled();});
it.each([undefined,'','   ','{"regenerate":false}','{"regenerate":true}'])('preserves empty/default and explicit regeneration requests: %s',async body=>{expect((await call(body)).status).toBe(202);expect(mocks.schedule).toHaveBeenCalledTimes(1);expect(mocks.schedule.mock.calls[0][3]).toBe(body?.includes('true')??false);});
it('checks authentication and Origin before reading or scheduling',async()=>{mocks.auth.mockResolvedValue(null);expect((await call('{')).status).toBe(401);mocks.auth.mockResolvedValue({user:{id:'owner'}});expect((await call('{','http://untrusted.example.test')).status).toBe(403);expect(mocks.schedule).not.toHaveBeenCalled();});

afterEach(() => vi.unstubAllEnvs());
