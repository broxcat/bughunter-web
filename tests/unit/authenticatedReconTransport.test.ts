import { describe, expect, it, vi } from 'vitest';
import { authenticatedExecutionHeaders, withTargetExecution, type TargetExecution } from '@/server/execution';
const base:TargetExecution={targetId:'target',host:'app.example.test',requiredUserAgent:'Auth-Recon-Fixture/1',qualifying:[],nonQualifying:[],scopeAsset:{id:'asset',programId:'program',normalizedValue:'https://app.example.test/app/',originalValue:'https://app.example.test/app/',format:'URL',active:true,type:'WEB_APPLICATION',assetValue:'MEDIUM'}};
describe('request-local authenticated Recon header injection',()=>{
  it('injects only the selected session after scope guards with the mandatory User-Agent',async()=>{
    const loader=vi.fn(async()=>({Cookie:'session=PRIVATE_COOKIE',Authorization:'Bearer PRIVATE_TOKEN'}));
    const headers=await withTargetExecution({...base,authenticatedOrigin:'https://app.example.test',authenticatedRequestHeaders:loader},()=>authenticatedExecutionHeaders('https://app.example.test/app/dashboard','GET'));
    expect(headers.get('Cookie')).toBe('session=PRIVATE_COOKIE');expect(headers.get('Authorization')).toBe('Bearer PRIVATE_TOKEN');expect(headers.get('User-Agent')).toBe(base.requiredUserAgent);expect(loader).toHaveBeenCalledOnce();
  });
  it.each([
    ['https://outside.test/app/','GET'],['https://admin.example.test/app/','GET'],['http://app.example.test/app/','GET'],['https://app.example.test:8443/app/','GET'],['https://app.example.test/outside/','GET'],['https://app.example.test/app/logout','GET'],['https://app.example.test/app/profile','POST'],
  ])('does not decrypt or inject credentials for %s %s',async(url,method)=>{
    const loader=vi.fn(async()=>({Cookie:'session=PRIVATE_COOKIE'}));
    await expect(withTargetExecution({...base,authenticatedOrigin:'https://app.example.test',authenticatedRequestHeaders:loader},()=>authenticatedExecutionHeaders(url,method))).rejects.toThrow();expect(loader).not.toHaveBeenCalled();
  });
  it.each(['Cookie','Authorization','Host','Proxy-Authorization'])('refuses caller-controlled %s before reading credentials',async name=>{
    const loader=vi.fn(async()=>({Cookie:'session=PRIVATE_COOKIE'}));
    await expect(withTargetExecution({...base,authenticatedOrigin:'https://app.example.test',authenticatedRequestHeaders:loader},()=>authenticatedExecutionHeaders('https://app.example.test/app/','GET',{[name]:'override'}))).rejects.toThrow('AUTH_CONTEXT_HEADER_OVERRIDE');expect(loader).not.toHaveBeenCalled();
  });
  it('rejects arbitrary authentication-loader headers instead of overriding transport policy',async()=>{
    await expect(withTargetExecution({...base,authenticatedOrigin:'https://app.example.test',authenticatedRequestHeaders:async()=>({'User-Agent':'override'})},()=>authenticatedExecutionHeaders('https://app.example.test/app/','GET'))).rejects.toThrow('AUTH_CONTEXT_HEADER_OVERRIDE');
  });
  it('loads each request independently and never caches a decrypted first credential',async()=>{
    const loader=vi.fn().mockResolvedValueOnce({Cookie:'session=PRIVATE_FIRST'}).mockRejectedValueOnce(new Error('AUTH_CONTEXT_SESSION_UNAVAILABLE'));
    await withTargetExecution({...base,authenticatedOrigin:'https://app.example.test',authenticatedRequestHeaders:loader},async()=>{
      await authenticatedExecutionHeaders('https://app.example.test/app/','HEAD');await expect(authenticatedExecutionHeaders('https://app.example.test/app/','GET')).rejects.toThrow('AUTH_CONTEXT_SESSION_UNAVAILABLE');
    });expect(loader).toHaveBeenCalledTimes(2);
  });
});
