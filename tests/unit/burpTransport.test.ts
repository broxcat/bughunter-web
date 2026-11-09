import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { sendViaBurpProxy,proxyFailureKind } from '../../docker/research/validator/burp-transport.mjs';
import { activeObservation } from '../../docker/research/validator/burp-active.mjs';
import { sanitizeHistoryItem, historyArguments } from '../../docker/research/validator/burp-http.mjs';
const acquire = async () => ({ headers: { 'user-agent': 'Research-Test/1' }, release: async () => {} });
const p={targetId:'fixture',targetHost:'app.example.test',scheme:'http',port:80,mode:'SCOPED_ACTIVE_HTTP',requiredUserAgent:'Research-Test/1',programScope:{rules:['*.example.test'],exclusions:['admin.example.test']}};
const input={targetHostname:p.targetHost,targetPort:80,usesHttps:false,content:`GET / HTTP/1.1\r\nHost: ${p.targetHost}\r\nUser-Agent: incorrect\r\nAuthorization: Bearer SECRET\r\n\r\n`};
const servers:Server[]=[];
const certificateDirectory=mkdtempSync(join(tmpdir(),'burp-unit-ca-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',join(certificateDirectory,'key.pem'),'-out',join(certificateDirectory,'ca.pem'),'-subj','/CN=Local unit-test proxy CA','-addext','basicConstraints=critical,CA:TRUE'],{stdio:'ignore'});
const certificate=new X509Certificate(readFileSync(join(certificateDirectory,'ca.pem'))).raw;
afterAll(()=>rmSync(certificateDirectory,{recursive:true,force:true}));
afterEach(async()=>{vi.unstubAllEnvs();for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}});
async function proxy(status=200){
 const requests:{url?:string;ua?:string;host?:string;id?:string;method?:string;body:string;length:number}[]=[];
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,ua:req.headers['user-agent'],host:req.headers.host,id:String(req.headers['x-bughunter-request-id']),method:req.method,body,length:Number(req.headers['content-length']??0)});res.writeHead(status,{'content-type':'text/plain','set-cookie':'sid=SECRET'}).end('Actual remote response');});servers.push(server);
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error();
 vi.stubEnv('BURP_PROXY_HOST','127.0.0.1');vi.stubEnv('BURP_PROXY_PORT',String(address.port));return {requests,server};
}
describe('guarded real HTTP proxy transport',()=>{
 it.each([5,7,56])('retains observed CONNECT502 even when curl exits with platform-dependent code%i',code=>{expect(proxyFailureKind(code,502)).toBe('TARGET_CONNECT_FAILURE');});
 it.each([5,7])('keeps genuine unreachable-proxy failures without a CONNECT response (code%i)',code=>{expect(proxyFailureKind(code,0)).toBe('BURP_PROXY_UNREACHABLE');});

 it.each([200,502])('preserves actual HTTP %i and injects required UA and correlation, without secret logs',async status=>{
  const upstream=await proxy(status),logs:unknown[]=[];
  // A hostile inherited NO_PROXY must never silently bypass Burp.
  vi.stubEnv('NO_PROXY','*');
  writeFileSync(join(certificateDirectory,'.curlrc'),'output = "/dev/null"\n');vi.stubEnv('CURL_HOME',certificateDirectory);
  const r=await sendViaBurpProxy('send_http1_request',input,p,{acquire,audit:(v:unknown)=>logs.push(v)});
  expect(r.remoteStatus).toBe(status);expect(r.transportResult).toBe('TARGET_HTTP_RESPONSE');expect(r.historyCapture).toBe(true);
  expect(upstream.requests).toHaveLength(1);expect(upstream.requests[0]).toMatchObject({url:'http://app.example.test:80/',ua:p.requiredUserAgent,host:p.targetHost,id:r.requestId});
  expect(r.response).not.toContain('sid=SECRET');expect(JSON.stringify(logs)).not.toMatch(/SECRET|Authorization|Cookie|incorrect/);
  expect(logs[0]).toMatchObject({requestId:r.requestId,targetId:p.targetId,proxyHost:'127.0.0.1',protocol:'HTTP/1.1',mcpTool:'send_http1_request',transportResult:'TARGET_HTTP_RESPONSE',remoteStatus:status});
 });
 it('preserves method, encoded path, UTF-8 body and correct Content-Length',async()=>{
  const up=await proxy(),body=JSON.stringify({value:'é'}),logs:unknown[]=[];
  const content=`POST /objects/../submit?token=QUERY_SECRET HTTP/1.1\r\nHost: ${p.targetHost}\r\nContent-Type: application/json\r\nContent-Length: 999\r\n\r\n${body}`;
  await sendViaBurpProxy('send_http1_request',{...input,content},p,{acquire,audit:(v:unknown)=>{logs.push(v);}});
  expect(up.requests[0]).toMatchObject({method:'POST',body,length:Buffer.byteLength(body),url:'http://app.example.test:80/objects/../submit?token=QUERY_SECRET'});expect(JSON.stringify(logs)).not.toContain('QUERY_SECRET');
 });
 it('does not synthesize HTTP 502 for an unreachable proxy',async()=>{
  const up=await proxy();await new Promise<void>(r=>up.server.close(()=>r()));
  await expect(sendViaBurpProxy('send_http1_request',input,p,{acquire,audit:()=>{}})).rejects.toMatchObject({message:'BURP_PROXY_UNREACHABLE',details:{remoteStatus:null,transportResult:'BURP_PROXY_UNREACHABLE'}});expect(up.requests).toHaveLength(0);
 });
 it.each([502,200])('distinguishes CONNECT/TLS failure from a remote HTTP response (CONNECT %i)',async status=>{
  const server=createServer((_req,res)=>res.writeHead(200,{'content-type':'application/octet-stream'}).end(certificate));servers.push(server);
  server.on('connect',(_req,socket)=>{socket.on('error',()=>{});socket.end(`HTTP/1.1 ${status} ${status===200?'Connection established':'Bad Gateway'}\r\nContent-Length: 0\r\n\r\n`,()=>socket.destroy());});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error();vi.stubEnv('BURP_PROXY_HOST','127.0.0.1');vi.stubEnv('BURP_PROXY_PORT',String(address.port));
  await expect(sendViaBurpProxy('send_http1_request',{...input,usesHttps:true,targetPort:443},{...p,scheme:'https',port:443},{acquire,audit:()=>{}})).rejects.toMatchObject({message:status===502?'TARGET_CONNECT_FAILURE':'TARGET_TLS_FAILURE',details:{remoteStatus:null,proxyConnectStatus:status}});
 });
 it.each([{...p,mode:'PROGRAM_PASSIVE'},{...p,programScope:{rules:['*.example.test'],exclusions:[p.targetHost]}}])('blocks unauthorized operations before any proxy call',async policy=>{
  const up=await proxy();await expect(sendViaBurpProxy('send_http1_request',input,policy)).rejects.toThrow();expect(up.requests).toHaveLength(0);
 });
 it('blocks a different destination before any call',async()=>{const up=await proxy();await expect(sendViaBurpProxy('send_http1_request',{...input,targetHostname:'other.example.test'},p)).rejects.toThrow('OUT_OF_SCOPE');expect(up.requests).toHaveLength(0);});
 it('distinguishes tool errors and unstructured Montoya output from an HTTP response',()=>{
  expect(activeObservation({isError:true,content:[{type:'text',text:'internal failure'}]},p)).toMatchObject({transportResult:'BURP_TOOL_ERROR',remoteStatus:null});
  expect(activeObservation({content:[{type:'text',text:'<no response>'}]},p)).toMatchObject({transportResult:'BURP_TOOL_RESPONSE',remoteStatus:null});
 });
 it('correlates real proxy history by generated UUID while independently validating the host',()=>{
  const id='269d624c-98b7-45e0-97ae-1fc8ed6e08c0';const item={request:`GET / HTTP/2\r\nHost: ${p.targetHost}\r\nUser-Agent: ${p.requiredUserAgent}\r\nX-BugHunter-Request-Id: ${id}\r\n\r\n`,response:'HTTP/2 200 OK\r\nContent-Type: text/plain\r\n\r\nProof'};
  expect(sanitizeHistoryItem(item,p)).toMatchObject({requestId:id,status:200,requiredUserAgentMatches:true});expect(historyArguments(p,10,0,id).regex).toContain(id);expect(()=>historyArguments(p,10,0,'injected|regex')).toThrow();
 });
});
