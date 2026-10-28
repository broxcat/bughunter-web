import { describe, it, expect } from 'vitest';
import { reconSeeds, matchesHost } from '@/lib/bountyProgram';
import { scanRejection, withTargetExecution } from '@/server/execution';
import { enforcedToolArgs } from '@/server/scanners/toolPolicy';

describe('wildcard discovery inputs', () => {
  it.each([
    [['*.example.test'], ['example.test']],
    [['*.api.example.test'], ['api.example.test']],
    [['api.example.test'], ['api.example.test']],
    [['example.test'], ['example.test']],
    [['*.example.test', 'api.other.test', '*.services.company.test'], ['example.test','api.other.test','services.company.test']],
    [['*.EXAMPLE.TEST.', 'example.test', '*.api.example.test', 'api.example.test'], ['example.test','api.example.test']],
  ])('derives and deduplicates technical seeds for %j without changing rules', (rules,expected) => {
    const original=[...rules];expect(reconSeeds(rules)).toEqual(expected);expect(rules).toEqual(original);
  });
  it.each(['www.example.test','api.example.test','foo.bar.example.test'])('matches %s under a wildcard', host=>expect(matchesHost(host,'*.example.test')).toBe(true));
  it.each(['example.test','example.org','evil-example.test','example.test.attacker.net','notexample.test'])('rejects %s under a wildcard',host=>expect(matchesHost(host,'*.example.test')).toBe(false));
  it('allows passive Recon with a wildcard and User-Agent laziza while retaining active-host restrictions',()=>{
    const target={host:'*.example.test',active:true,userId:'owner',scope:{status:'APPROVED'},program:{ownerId:'owner',requiredUserAgent:'laziza',scopeRules:['*.example.test'],outOfScope:[]}};
    expect(scanRejection(target,'RECON')).toBeNull();expect(scanRejection(target)).toMatch(/discovery rule/);
    expect(scanRejection({...target,scope:{status:'REVOKED'}},'RECON')).toMatch(/APPROVED/);
    expect(scanRejection({...target,program:{...target.program,deletingAt:new Date()}},'RECON')).toMatch(/deletion/);
  });
  it('confines subfinder to exact authorized seeds, passive flags and the existing process wrapper',()=>{
    withTargetExecution({targetId:'context',host:'program.invalid',programReconId:'program',reconSeeds:['api.example.test'],requiredUserAgent:'laziza',qualifying:[],nonQualifying:[]},()=>{
      expect(enforcedToolArgs('subfinder',['-d','api.example.test'])).toEqual(['-d','api.example.test','-silent','-duc','-timeout','15','-max-time','1','-rl','5']);
      for(const args of [['-d','*.api.example.test'],['-d','example.test'],['-d','api.example.test','-active'],['-d','api.example.test; id']])expect(()=>enforcedToolArgs('subfinder',args)).toThrow();
      for(const tool of ['nmap','httpx','katana'])expect(()=>enforcedToolArgs(tool,[])).toThrow(/passive/);
    });
  });
});
