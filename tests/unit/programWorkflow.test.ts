import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { certificateNames, discoveryState } from '@/server/recon/program';
import { issueStopTicket, verifyStopTicket, issueTerminalTicket } from '@/lib/research/terminal';
import { consoleBundle } from '@/server/research/consoleWorkspace';
import { consolePolicySchema } from '@/lib/research/consolePolicy';
import { scanRejection } from '@/server/execution';
import { researchTarget } from '../fixtures/research';
import { enforceHttp1 } from '../../docker/research/validator/burp-active.mjs';
import { BurpResearch } from '../../docker/research/validator/burp-service.mjs';

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
describe('global Codex context and Burp restrictions',()=>{
  const programTarget=()=>({...researchTarget(),contextOnly:true,active:false,host:'program.invalid',credentials:[]});
  const bundle=()=>consoleBundle(programTarget(),null,[],{id:'session',workspaceId:'research_target',createdAt:new Date()});
  const policy=()=>consolePolicySchema.parse(JSON.parse(bundle()['.agents/bughunter/policy.json']));
  it('works without hosts, loads official scope through developer instructions and permits passive MCP only',()=>{
    const files=bundle();expect(files['scope.md']).toContain('*.example.test');expect(files['scope.md']).toContain('admin.example.test');
    expect(files['.codex/config.toml']).toContain('developer_instructions');expect(files['.codex/config.toml']).toContain('Read scope.md');
    expect(files['.codex/config.toml']).toContain('burp_status');expect(files['.codex/config.toml']).not.toContain('send_http1_request');
    expect(files['.codex/config.toml']).not.toContain('[mcp_servers.playwright]');expect(policy().mode).toBe('PROGRAM_PASSIVE');
    expect(()=>enforceHttp1({targetHostname:'program.invalid',targetPort:443,usesHttps:true,content:'GET / HTTP/1.1\r\nHost: program.invalid\r\n\r\n'},policy())).toThrow('TOOL_NOT_ALLOWED');
  });
  it('requires an authorized concrete host for passive history, supports reconnection after upstream loss',async()=>{
    let online=false,calls=0;
    const upstream=async(fn:(c:unknown)=>unknown)=>{if(!online)throw new Error('UNAVAILABLE');return fn({callTool:async()=>{calls++;return{content:[{type:'text',text:'Reached end of items'}]};}});};
    const burp=new BurpResearch(policy(),upstream);
    expect((await burp.diagnostic()).upstream).toBe('UNAVAILABLE');online=true;expect((await burp.diagnostic()).upstream).toBe('AVAILABLE');
    for(const host of ['admin.example.test','evil-example.test','example.test','*.example.test'])await expect(burp.history(2,0,host)).rejects.toThrow('OUT_OF_SCOPE');
    await burp.history(2,0,'api.example.test');expect(calls).toBe(1);
  });
});
describe('signed process cleanup authority',()=>{
  it('binds workspace, operation and expiry and rejects a browser terminal ticket',()=>{
    const keys=generateKeyPairSync('ed25519'),privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
    const token=issueStopTicket('target','research_target',privateKey,100000);
    expect(verifyStopTicket(token,publicKey,101000).targetId).toBe('target');expect(()=>verifyStopTicket(token,publicKey,131000)).toThrow();
    expect(()=>issueStopTicket('target','../other',privateKey)).toThrow();expect(()=>verifyStopTicket(issueStopTicket('target','research_other',privateKey),publicKey)).toThrow();
    const terminal=issueTerminalTicket({targetId:'target',sessionId:'session',userId:'owner',policySha256:'a'.repeat(64)},privateKey);
    expect(()=>verifyStopTicket(terminal.token,publicKey)).toThrow();expect(()=>verifyStopTicket(token+'x',publicKey,101000)).toThrow();
  });
});
