// Called inside the disposable console/browser harness. Actual official Burp,
// real Java proxy, native Codex RPC, real browser. Only local fixture traffic.
import assert from 'node:assert/strict';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
export async function portSwiggerAcceptance({ image, runnerImage, prefix, consoleId, run, dexec, connectMcp, page, origin, hostId, wait, webScript }) {
  const burp = prefix + '-real-burp', fixture = prefix + '-real-http';
  let client;
  const probe = () => dexec('node','--input-type=module','-e',`import {diagnoseOfficialBurp} from '/opt/bughunter/docker/research/validator/burp-proxy.mjs';console.log(JSON.stringify(await diagnoseOfficialBurp()));`);
  const javaPids = async () => JSON.parse(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','node','--input-type=module','-e',`import {readdir,readlink,readFile} from 'node:fs/promises';const ids=[];for(const id of await readdir('/proc')){if(!/^\\d+$/.test(id))continue;try{if(await readlink('/proc/'+id+'/cwd')===process.argv[1]&&(await readFile('/proc/'+id+'/cmdline','utf8')).includes('/opt/portswigger/mcp-proxy-all.jar'))ids.push(Number(id));}catch{}}console.log(JSON.stringify(ids));`,`/workspaces/research_${hostId}`));
  const codex = (method, params, id=hostId) => dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','sh','-c',`cd /workspaces/research_${id} && node --input-type=module -e 'import {codexRead} from "/opt/bughunter/docker/research/validator/codex-rpc.mjs";console.log(JSON.stringify(await codexRead(${JSON.stringify(method)},${JSON.stringify(params)},process.cwd(),45000,true)));'`);
  try {
    await run('docker',['run','-d','--name',fixture,'--network',`container:${consoleId}`,'--entrypoint','node',runnerImage,'-e',`require('http').createServer((q,r)=>r.writeHead(200,{'content-type':'text/html'}).end('<html><h1>Actual Burp local proof</h1></html>')).listen(80,'0.0.0.0');`]);
    await dexec('sh','-c',"printf '\\n127.0.0.1 browser.example.test tls.example.test\\n' >> /etc/hosts");
    await run('docker',['run','-d','--name',burp,'--network',`container:${consoleId}`,'-e','BURP_ACCEPT_TERMS=yes',image]);
    for(let i=0;i<180;i++) {
      try { await run('docker',['exec',burp,'test','-f','/tmp/bughunter-burp-ready']); break; }
      catch { if(i===179) { console.error(await run('docker',['logs','--tail','30',burp])); throw new Error('Real Burp failed startup'); } await wait(500); }
    }
    const inspected=JSON.parse(await run('docker',['inspect',burp]))[0];
    assert.equal(inspected.HostConfig.NetworkMode,`container:${consoleId}`); assert.equal(inspected.HostConfig.PidMode,''); assert.equal(Object.keys(inspected.HostConfig.PortBindings ?? {}).length,0);
    const diagnostic=JSON.parse(await probe()); assert.equal(diagnostic.status,'connected',JSON.stringify(diagnostic));
    assert(diagnostic.toolCount>3); console.log('REAL PORTSWIGGER INVENTORY:',JSON.stringify(diagnostic));
    await page.goto(origin+`/research/${hostId}`); await page.getByText('Terminal: connected',{exact:true}).waitFor({timeout:30000}); await page.getByText('Burp MCP: connected',{exact:true}).waitFor({timeout:30000});
    client=await connectMcp(hostId,'bughunter-playwright-mcp');
    const marker='burp-proof-'+Date.now();
    const navigation=await client.callTool({name:'browser_navigate',arguments:{url:`http://browser.example.test/${marker}`}});assert(!navigation.isError,JSON.stringify(navigation));
    await client.close(); client=await connectMcp(hostId,'bughunter-portswigger-mcp');
    let notifications=0;client.setNotificationHandler(ToolListChangedNotificationSchema,async()=>{notifications++;});
    const names=(await client.listTools()).tools.map(t=>t.name);assert.deepEqual(names,diagnostic.tools);
    const history=await client.callTool({name:'get_proxy_http_history',arguments:{count:20,offset:0}});assert(!history.isError,JSON.stringify(history));
    const item=JSON.parse(history.content[0].text).items.find(i=>i.url.includes(marker));assert(item,'Real browser request missing from Burp history');assert(item.requiredUserAgentMatches);
    const discovered=JSON.parse(await codex('mcpServerStatus/list',{serverName:'burp'}));
    const server=discovered.data.find(s=>s.name==='burp');assert(server);assert(JSON.stringify(server.tools).includes('get_proxy_http_history'));assert(Object.keys(server.tools).length>3);
    const throughCodex=JSON.parse(await codex('mcpServer/tool/call',{server:'burp',tool:'get_proxy_http_history',arguments:{count:20,offset:0}}));
    assert(!throughCodex.isError,JSON.stringify(throughCodex));assert(JSON.stringify(throughCodex).includes(marker),'Native Codex tool call must see the real captured browser request');
    // A genuine HTTP/2 TLS origin, reached exclusively through real Burp.
    await run('docker',['exec',fixture,'openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout','/tmp/fixture.key','-out','/tmp/fixture.crt','-subj','/CN=tls.example.test','-addext','subjectAltName=DNS:tls.example.test']);
    await run('docker',['exec','-d',fixture,'node','-e',`const f=require('fs');require('http2').createSecureServer({key:f.readFileSync('/tmp/fixture.key'),cert:f.readFileSync('/tmp/fixture.crt'),allowHTTP1:true},(q,r)=>r.writeHead(200,{'content-type':'text/plain','x-fixture-protocol':q.httpVersion}).end('Controlled TLS origin')).listen(443,'0.0.0.0');`]);
    const tls=await webScript(`import {PrismaClient} from '@prisma/client';import {ensureTargetConsole} from './src/server/research/consoleWorkspace.ts';const p=new PrismaClient(),parent=await p.target.findUniqueOrThrow({where:{id:${JSON.stringify(hostId)}}});const scope=await p.scope.create({data:{userId:parent.userId,hostPattern:'tls.example.test',status:'APPROVED'}});const t=await p.target.create({data:{userId:parent.userId,scopeId:scope.id,programId:parent.programId,host:'tls.example.test',scheme:'https'}});await ensureTargetConsole(t.userId,t.id);console.log(JSON.stringify({id:t.id}));await p.$disconnect();`);
    for(const tool of ['send_http1_request','send_http2_request']) {
      const base={targetHostname:'tls.example.test',targetPort:443,usesHttps:true};
      const args=tool==='send_http1_request'?{...base,content:'GET / HTTP/1.1\r\nHost: tls.example.test\r\nUser-Agent: wrong\r\n\r\n'}:{...base,pseudoHeaders:{':method':'GET',':scheme':'https',':authority':'tls.example.test',':path':'/'},headers:{'user-agent':'wrong'},requestBody:''};
      const sent=JSON.parse(await codex('mcpServer/tool/call',{server:'bughunter_burp',tool,arguments:args},tls.id));assert(!sent.isError,JSON.stringify(sent));
      const result=JSON.parse(sent.content[0].text);assert.equal(result.remoteStatus,200);assert.equal(result.transport,'BURP_PROXY');assert.equal(result.protocol,tool==='send_http1_request'?'HTTP/1.1':'HTTP/2');
      const captured=JSON.parse(await codex('mcpServer/tool/call',{server:'bughunter_burp',tool:'burp_history',arguments:{count:10,offset:0,requestId:result.requestId}},tls.id));assert(!captured.isError,JSON.stringify(captured));
      const record=JSON.parse(captured.content[0].text).items.find(i=>i.requestId===result.requestId);assert(record,'The exact active request must appear in official Proxy History');assert.equal(record.status,200);assert(record.requiredUserAgentMatches);
      console.log('REAL ACTIVE BURP VERIFIED:',JSON.stringify({tool,protocol:result.protocol,requestId:result.requestId,remoteStatus:200,historyStatus:record.status,requiredUserAgentMatches:record.requiredUserAgentMatches,nativeCodex:true}));
    }
    // Real global target console, without any pre-existing host, sees the same
    // upstream inventory and scoped history while rejecting active calls.
    const program=await page.evaluate(async()=>{const r=await fetch('/api/programs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyName:'Real Burp isolated program',requiredUserAgent:'Research-Test/1',scopeRules:['*.example.test'],outOfScope:['admin.example.test']})});if(!r.ok)throw new Error(await r.text());return r.json();});
    await page.goto(origin+'/targets/'+program.id);await page.getByRole('button',{name:'Codex Console',exact:true}).click();await page.getByRole('button',{name:'Launch Codex Console',exact:true}).click();
    await page.getByText('Burp MCP: connected',{exact:true}).waitFor({timeout:30000});
    const global=await webScript(`import {PrismaClient} from '@prisma/client';const p=new PrismaClient();const t=await p.target.findFirstOrThrow({where:{programId:${JSON.stringify(program.id)},contextOnly:true}});console.log(JSON.stringify({id:t.id}));await p.$disconnect();`);
    const globalMcp=await connectMcp(global.id,'bughunter-portswigger-mcp');
    assert.equal((await globalMcp.listTools()).tools.length,diagnostic.toolCount);
    const globalHistory=await globalMcp.callTool({name:'get_proxy_http_history',arguments:{count:20,offset:0}});assert(JSON.stringify(globalHistory).includes(marker));
    assert((await globalMcp.callTool({name:'send_http1_request',arguments:{targetHostname:'browser.example.test',targetPort:80,usesHttps:false,content:'GET / HTTP/1.1\r\nHost: browser.example.test\r\n\r\n'}})).isError);
    await globalMcp.close();
    await page.getByRole('button',{name:'Settings',exact:true}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Supprimer la target',exact:true}).click();await page.waitForURL(origin+'/targets?deleted=1',{timeout:40000});
    assert.equal(JSON.parse(await probe()).status,'connected','Deleting a target must preserve the shared real Burp');
    await page.goto(origin+`/research/${hostId}`);await page.getByText('Terminal: connected',{exact:true}).waitFor({timeout:30000});await page.getByText('Burp MCP: connected',{exact:true}).waitFor({timeout:30000});
    // Reconnect preserves the actual terminal, replaces Java and rediscovers tools.
    const listBefore=(await client.listTools()).tools.length;
    const oldJava=await javaPids();assert(oldJava.length>0);
    await page.getByRole('button',{name:'Reconnect',exact:true}).click();await page.getByText('Burp MCP: connected',{exact:true}).waitFor({timeout:30000});
    assert.equal((await client.listTools()).tools.length,listBefore);
    assert(notifications>0,'Reconnect must notify the already connected MCP client');
    const newJava=await javaPids();assert(newJava.length>0);assert(newJava.every(pid=>!oldJava.includes(pid)),'Reconnect must terminate the old Java proxies');assert(newJava.length<=oldJava.length,'Reconnect must not accumulate Java proxies');
    await run('docker',['stop','--time','5',burp]);
    await page.getByRole('button',{name:'Reconnect',exact:true}).click();await page.getByText('Burp MCP: unavailable',{exact:true}).waitFor({timeout:30000});
    assert.equal((await client.listTools()).tools.length,0);
    await run('docker',['start',burp]);
    for(let i=0;i<180;i++){try{await run('docker',['exec',burp,'sh','-c','test -f /tmp/bughunter-burp-ready']);if(JSON.parse(await probe()).status==='connected')break;}catch{}if(i===179)throw new Error('Real Burp did not recover');await wait(500);}
    await page.getByRole('button',{name:'Reconnect',exact:true}).click();await page.getByText('Burp MCP: connected',{exact:true}).waitFor({timeout:30000});assert((await client.listTools()).tools.length>3);
    // The extension's tool inventory can recover before history is readable.
    // Poll only this passive readiness read; never replay an active target call.
    let emptyHistory;
    for(let attempt=0;attempt<10;attempt++){
      emptyHistory=await client.callTool({name:'get_proxy_http_history',arguments:{count:20,offset:0}});
      if(!emptyHistory.isError)break;
      await wait(500);
    }
    assert(!emptyHistory.isError,JSON.stringify(emptyHistory));assert.deepEqual(JSON.parse(emptyHistory.content[0].text).items,[],'Community restart uses a fresh in-memory project');
    const passive = await connectMcp(hostId,'bughunter-burp-passive-mcp');
    try {
      assert.deepEqual((await passive.listTools()).tools.map(tool=>tool.name),['burp_status','burp_history','burp_save_observation']);
      assert.equal(JSON.parse((await passive.callTool({name:'burp_status',arguments:{}})).content[0].text).upstream,'AVAILABLE');
      assert(!(await passive.callTool({name:'burp_history',arguments:{count:1,offset:0}})).isError);
      console.log('CLAUDE PASSIVE RELAY VERIFIED with real Burp: server inventory, upstream protocol connection, bounded history; no authenticated Claude model/tool invocation claimed.');
    } finally {await passive.close();}
    console.log('REAL BURP VERIFIED: Community 2026.10.1 + official extension 1.3.0; Java stdio/SSE tools/list; Playwright → real proxy → local HTTP → real history → native Codex mcpServer/tool/call; UA, private binding, real disconnect/restart/reconnect.');
  } finally {
    await client?.close().catch(()=>{});
    for(const name of [burp,fixture])await run('docker',['rm','-f',name]).catch(()=>{});
  }
}
