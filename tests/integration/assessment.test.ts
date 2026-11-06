import {describe,it,expect,vi} from 'vitest';
vi.mock('@/lib/auth',()=>({auth:vi.fn(async()=>({user:{id:'owner'}}))}));
import * as mode from '@/app/api/programs/[id]/assessment/route';
import * as sources from '@/app/api/programs/[id]/assessment-sources/route';
import * as source from '@/app/api/programs/[id]/assessment-sources/[sourceId]/route';
describe('retired assessment API',()=>{it('returns Gone for every historical endpoint without consuming source data',async()=>{
 for(const route of [mode.PATCH,sources.GET,sources.POST,source.PATCH,source.DELETE])expect((await route()).status).toBe(410);
});});
