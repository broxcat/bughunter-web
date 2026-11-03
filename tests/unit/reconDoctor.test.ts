import { describe, expect, it } from 'vitest';
import { assessTool, embeddedGoCompiler, executableArchitecture, parseToolVersion, runtimeDependencyEvidence } from '@/server/recon/toolchain';
function elf(machine:number) { const b=Buffer.alloc(64);b.set([0x7f,0x45,0x4c,0x46,2,1]);b.writeUInt16LE(machine,18);return b; }
describe('Recon Doctor executable and compatibility contract',()=>{
  it('reads explicit ELF architecture without trusting the file name',()=>{expect(executableArchitecture(elf(62))).toBe('x64');expect(executableArchitecture(elf(183))).toBe('arm64');expect(executableArchitecture(Buffer.alloc(8))).toBe('UNKNOWN');});
  it('handles native version variants and explicitly identifies unversioned upstream tools',()=>{expect(parseToolVersion('nuclei','Nuclei Engine Version: v3.11.1')).toBe('3.11.1');expect(parseToolVersion('gobuster','gobuster version 3.8.2')).toBe('3.8.2');expect(parseToolVersion('nmap','Nmap version 7.93')).toBe('7.93');expect(parseToolVersion('assetfinder','Usage')).toContain('unversioned');});
  const flags='--delay --threads --timeout --expanded --exclude-length --status-codes-blacklist';
  it('accepts only audited installed versions, flags, architecture and resolved runtime',()=>{expect(assessTool('gobuster','3.8.2',flags,process.arch,'resolved')).toMatchObject({status:'READY',capable:true});for(const version of ['3.8.1','3.9.0','unknown'])expect(assessTool('gobuster',version,flags,process.arch,'resolved').status).toBe('INCOMPATIBLE');expect(assessTool('gobuster','3.8.2','--timeout',process.arch,'resolved').status).toBe('INCOMPATIBLE');expect(assessTool('gobuster','3.8.2',flags,'UNKNOWN','resolved').status).toBe('INCOMPATIBLE');expect(assessTool('gobuster','3.8.2',flags,process.arch,'libexample.so => not found').status).toBe('INCOMPATIBLE');});
  it('extracts the actual embedded Go compiler without a runtime SDK',()=>{const b=Buffer.alloc(80);Buffer.from('\xff Go buildinf:','latin1').copy(b);b[15]=2;b[32]=9;Buffer.from('go1.26.10').copy(b,33);expect(embeddedGoCompiler(b)).toBe('go1.26.10');expect(embeddedGoCompiler(Buffer.alloc(8))).toBeUndefined();});
  it('does not hide Sonic fallback as a successful runtime',()=>{expect(assessTool('nuclei','3.11.1','-jsonl -dr -duc -ni -omit-raw',process.arch,'resolved','WARNING: sonic/ast unsupported; fallback to encoding/json')).toMatchObject({status:'INCOMPATIBLE',capable:false});});
  it('rejects unavailable or timed-out runtime inspection while accepting explicit static binaries',()=>{
    for(const output of ['', 'ldd: command not found', 'inspection timed out']){
      const runtime=runtimeDependencyEvidence(output,false);
      expect(runtime).toMatch(/^UNVERIFIED:/);
      expect(assessTool('gobuster','3.8.2',flags,process.arch,runtime)).toMatchObject({status:'INCOMPATIBLE',capable:false});
    }
    expect(runtimeDependencyEvidence('not a dynamic executable',false)).toBe('not a dynamic executable');
    expect(assessTool('gobuster','3.8.2',flags,process.arch,runtimeDependencyEvidence('statically linked',false))).toMatchObject({status:'READY',capable:true});
  });
});
