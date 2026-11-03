import {describe,it,expect} from 'vitest';
import {wildcardDnsBaseline} from '@/server/recon/dnsIntelligence';
describe('documentary wildcard DNS controls',()=>{
 it('identifies two matching negative resolutions without creating discovered hosts',async()=>{const names:string[]=[];const result=await wildcardDnsBaseline('example.test',async name=>{names.push(name);return['192.0.2.1'];},h=>h.endsWith('.example.test'));expect(result.detected).toBe(true);expect(result.addresses).toEqual(['192.0.2.1']);expect(names).toHaveLength(2);expect(result.fingerprint).toHaveLength(64);});
 it('does not infer wildcard from inconsistent or empty answers',async()=>{let n=0;expect((await wildcardDnsBaseline('example.test',async()=>++n===1?['192.0.2.1']:[],()=>true)).detected).toBe(false);});
 it('never resolves an unauthorized control',async()=>{let calls=0;await expect(wildcardDnsBaseline('example.test',async()=>{calls++;return[];},()=>false)).rejects.toThrow('SCOPE_BLOCKED');expect(calls).toBe(0);});
 it('keeps resolver timeouts inconclusive instead of claiming wildcard absence',async()=>{const result=await wildcardDnsBaseline('example.test',async()=>{throw Object.assign(new Error('queryA ETIMEOUT'),{code:'ETIMEOUT'});},()=>true);expect(result).toMatchObject({complete:false,detected:false,addresses:[]});expect(result.failures).toHaveLength(2);expect(result.failures.every(f=>f.reason==='TIMEOUT')).toBe(true);});
 it('retains terminal negative controls as completed DNS observations',async()=>{const result=await wildcardDnsBaseline('example.test',async()=>{throw Object.assign(new Error('queryA ENOTFOUND'),{code:'ENOTFOUND'});},()=>true);expect(result).toMatchObject({complete:true,detected:false,failures:[]});});
 it('does not swallow execution cancellation while collecting controls',async()=>{const stopped=new DOMException('Control aborted','AbortError');await expect(wildcardDnsBaseline('example.test',async()=>{throw stopped;},()=>true)).rejects.toBe(stopped);});
});
