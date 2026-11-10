import { describe, expect, it } from 'vitest';
import { certificateNames, discoveryState } from '@/server/recon/program';
import { targetIdentity } from '@/lib/research/identity';
import { scanRejection } from '@/server/execution';
import { researchTarget } from '../fixtures/research';

describe('program Recon scope and streaming', () => {
  it.each([
    ['api.example.test','VALIDATED'], ['example.test','OUT_OF_SCOPE'], ['evilexample.test','OUT_OF_SCOPE'],
    ['example.test.evil.test','OUT_OF_SCOPE'], ['admin.example.test','EXCLUDED'], ['x.private.example.test','EXCLUDED'],
  ])('classifies %s with label boundaries and exclusion priority', (host,state) => {
    expect(discoveryState(host,['*.example.test'],['admin.example.test','*.private.example.test'])).toBe(state);
  });
  it('yields certificate names before the provider stream completes, across split/escaped strings',async()=>{
    let controller!:ReadableStreamDefaultController<Uint8Array>;
    const response=new Response(new ReadableStream({start(c){controller=c;}}));
    const names=certificateNames(response),first=names.next();
    controller.enqueue(new TextEncoder().encode('[{"name_val'));
    controller.enqueue(new TextEncoder().encode('ue":"api.example.test\\nadmin.example.test"},'));
    expect(await first).toEqual({value:'api.example.test',done:false});
    expect(await names.next()).toEqual({value:'admin.example.test',done:false});
    controller.enqueue(new TextEncoder().encode('{"name_value":"other.test"}]'));controller.close();
    expect(await names.next()).toEqual({value:'other.test',done:false});expect((await names.next()).done).toBe(true);
  });
  it('rejects truncated/provider-error responses',async()=>{
    await expect(async()=>{for await(const name of certificateNames(new Response('[{"name_value":"api')))void name;}).rejects.toThrow();
    await expect(async()=>{for await(const name of certificateNames(new Response('',{status:503})))void name;}).rejects.toThrow();
  });
  it('rechecks current official rules for discovered hosts and blocks deletion',()=>{
    const target=researchTarget();
    expect(scanRejection({...target,discoverySource:'CERTIFICATE_TRANSPARENCY',program:{...target.program!,scopeRules:['other.test']}})).toContain('no longer');
    expect(scanRejection({...target,program:{...target.program!,deletingAt:new Date()}})).toContain('deletion');
  });
});
describe('Target identity used by deletion and context routes',()=>{
  it.each(['target','cm0abc_123-x','A'.repeat(100)])('accepts database identity %s',id=>expect(targetIdentity.safeParse(id).success).toBe(true));
  it.each(['','../other','research/target','-leading','a b','A'.repeat(101)])('rejects path or oversized identity %j',id=>expect(targetIdentity.safeParse(id).success).toBe(false));
});
