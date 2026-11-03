// Real final-image PTY/tmux, browser, official proxy and browser-proxy path.
// Own labelled disposable containers/keys/DB only. No operator or model login.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect as netConnect } from 'node:net';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-chromium';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { issueTerminalTicket } from '../../src/lib/research/terminal.ts';
import { portSwiggerAcceptance } from './portSwiggerAcceptance.mjs';
import { verifyConsoleClipboard } from './clipboard.mjs';
import { fakeBurp } from './fakeBurp.mjs';
const execute = promisify(execFile), prefix = `bh-console-${randomUUID().slice(0,8)}`, temp = await mkdtemp(join(tmpdir(),prefix));
const run = async (file,args,options={}) => (await execute(file,args,{timeout:60000,maxBuffer:2**20,...options})).stdout.trim();
const config=join(temp,'compose.json'), compose=(...args)=>run('docker',['compose','-p',prefix,'-f',config,...args],{timeout:args[0]==='up'?180000:60000});
const freePort=async()=>{const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let started=false, ingress, browser, tunnel, fixture, proxyFixture, targetFixture, mcp, reconWorker;
const keys=generateKeyPairSync('ed25519'), privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
let consoleId;
const dexec=(...args)=>{if(args[0]==='setpriv'){const at=args.indexOf('--init-groups')+1;args.splice(at,0,'env','HOME=/home/researcher','CODEX_HOME=/home/researcher/.codex','USER=researcher');}return run('docker',['exec',consoleId,...args]);};
async function webScript(script){
 const child=spawn('docker',['compose','-p',prefix,'-f',config,'exec','-T','web','node','--import','tsx','--input-type=module'],{stdio:['pipe','pipe','pipe']});let output='',error='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>error+=d);child.stdin.end(script);const code=await new Promise(r=>child.on('close',r));assert.equal(code,0,error.slice(-1500));return JSON.parse(output);
}
try {
 const original=JSON.parse(await run('docker',['compose','config','--format','json'])), service=original.services['research-console'];
 assert(!service.env_file);assert(!JSON.stringify(service).match(/docker\.sock|DATABASE_URL|REDIS_URL|AUTH_SECRET|privileged|SYS_ADMIN/));
 assert.deepEqual(Object.keys(service.networks).sort(),['burp_link','research_egress','research_terminal']);assert.equal(service.ports[0].host_ip,'127.0.0.1');
 const [appPort,terminalPort,sshPort,publicPort]=await Promise.all([freePort(),freePort(),freePort(),freePort()]); const origin=`http://127.0.0.1:${publicPort}`;
 await writeFile(join(temp,'private.pem'),privateKey,{mode:0o600});await writeFile(join(temp,'public.pem'),keys.publicKey.export({type:'spki',format:'pem'}));
 await run('ssh-keygen',['-q','-t','ed25519','-N','','-f',join(temp,'ssh')]);await writeFile(join(temp,'authorized_keys'),await readFile(join(temp,'ssh.pub')));
 // This acceptance runner starts both providers, app-server probes and multiple
 // independent workspaces concurrently. Keep its fixture process budget local.
 service.pids_limit=2048;
 service.networks={research_egress:{},research_terminal:{}};delete service.build;service.image=process.env.RESEARCH_TEST_RUNNER_IMAGE??service.image;service.restart='no';service.environment={RESEARCH_TERMINAL_ORIGIN:origin};
 service.ports=[{target:22,published:String(sshPort),host_ip:'127.0.0.1'},{target:7681,published:String(terminalPort),host_ip:'127.0.0.1'}];
 service.volumes=[{type:'volume',source:'targets',target:'/workspaces'},{type:'volume',source:'codex',target:'/home/researcher/.codex'},{type:'volume',source:'claude',target:'/home/researcher/.claude'},{type:'volume',source:'hostkeys',target:'/etc/ssh/host-keys'}, {type:'bind',source:join(temp,'public.pem'),target:'/run/research-terminal/public.pem',read_only:true},{type:'bind',source:join(temp,'authorized_keys'),target:'/run/research-keys/authorized_keys',read_only:true}];
 await writeFile(config,JSON.stringify({services:{'research-console':service,web:{image:process.env.RESEARCH_TEST_APP_IMAGE??'bughunter-web',command:['npm','run','start'],restart:'no',ports:[{target:3000,published:String(appPort),host_ip:'127.0.0.1'}],networks:['backend','research_terminal'],environment:{DATABASE_URL:'postgresql://postgres:disposable-console@db:5432/postgres',REDIS_URL:'redis://redis:6379',AUTH_URL:origin,AUTH_SECRET:randomUUID(),CREDENTIALS_ENCRYPTION_KEY:'ab'.repeat(32),RESEARCH_WORKSPACE_ROOT:'/research-workspaces',RESEARCH_CONSOLE_ROOT:'/research-target-workspaces',RESEARCH_WORKSPACE_UID:'1000',RESEARCH_WORKSPACE_GID:'1000',RESEARCH_TERMINAL_PRIVATE_KEY_FILE:'/run/research-terminal/private.pem',LOG_LEVEL:'silent',ALLOW_PUBLIC_REGISTRATION:'true',TRUST_PROXY_HEADERS:'false'},volumes:[{type:'volume',source:'targets',target:'/research-target-workspaces'},{type:'volume',source:'legacy',target:'/research-workspaces'},{type:'bind',source:join(temp,'private.pem'),target:'/run/research-terminal/private.pem',read_only:true}]},db:{image:'postgres:16-alpine',tmpfs:['/var/lib/postgresql/data'],environment:{POSTGRES_PASSWORD:'disposable-console'},networks:['backend']},redis:{image:'redis:7-alpine',networks:['backend']}},volumes:{targets:{},legacy:{},codex:{},claude:{},hostkeys:{}},networks:{backend:{},research_egress:{},research_terminal:{internal:true}}}));
 started=true;await compose('up','-d','db','redis','research-console');consoleId=await compose('ps','-q','research-console');
 for(let i=0;i<100;i++){try{await compose('exec','-T','db','pg_isready','-U','postgres');await dexec('console-healthcheck');break;}catch(error){if(i===0)console.error('Initial local health diagnostic:',error.stderr?.slice(-1000) ?? error.message);if(i===99){console.error(await compose('logs','--tail','30','research-console'));throw new Error('Disposable console failed readiness');}await wait(200);}}
 await compose('run','--rm','--no-deps','web','npx','prisma','migrate','deploy');await compose('up','-d','web');
 ingress=createServer((req,res)=>{const upstream=request({host:'127.0.0.1',port:appPort,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>res.writeHead(503).end());req.pipe(upstream);});
 ingress.on('upgrade',(req,socket,head)=>{const upstream=netConnect(terminalPort,'127.0.0.1',()=>{upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${req.rawHeaders.reduce((headers,value,i)=>{if(i%2===0&&!['cookie','authorization','proxy-authorization'].includes(value.toLowerCase()))headers.push(value+': '+req.rawHeaders[i+1]);return headers;},[]).join('\r\n')+'\r\n'}\r\n`);if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());});
 await new Promise(r=>ingress.listen(publicPort,'127.0.0.1',r));
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}await wait(100);if(i===99)throw new Error('Disposable web unavailable');}
 const data=await webScript(`import {PrismaClient} from '@prisma/client';import bcrypt from 'bcryptjs';import {randomUUID} from 'node:crypto';const p=new PrismaClient(),password=randomUUID();const u=await p.user.create({data:{email:randomUUID()+'@example.test',passwordHash:await bcrypt.hash(password,10)}});const program=await p.bountyProgram.create({data:{ownerId:u.id,companyName:'Console local fixture',requiredUserAgent:'Research-Test/1'}});const ids=[];for(const [host,scheme] of [['app.example.test','https'],['browser.example.test','http']]){const scope=await p.scope.create({data:{userId:u.id,hostPattern:host,status:'APPROVED'}});ids.push((await p.target.create({data:{userId:u.id,scopeId:scope.id,programId:program.id,host,scheme}})).id);}console.log(JSON.stringify({userId:u.id,email:u.email,password,ids}));await p.$disconnect();`);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext(),page=await context.newPage();
 await page.goto(origin+'/login');await page.getByLabel('Email',{exact:true}).fill(data.email);await page.getByLabel('Password',{exact:true}).fill(data.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(origin+'/targets');
 await page.goto(origin+'/research');await page.getByRole('link',{name:'Open console — app.example.test',exact:true}).click();await page.waitForURL(origin+`/research/${data.ids[0]}`);
 await page.locator('.xterm-screen').waitFor();try{await page.getByText('Terminal: connected',{exact:true}).waitFor({timeout:30000});}catch(e){console.error('Console UI:',(await page.locator('body').innerText()).slice(0,600));console.error(await compose('logs','--tail','35','research-console'));throw e;}
 assert.equal(await page.getByRole('navigation').count(),0);assert(!(await page.locator('body').innerText()).includes(data.email));assert.equal(await page.getByText('Download workspace ZIP',{exact:true}).count(),0);
 const sessionName='bughunter-'+data.ids[0],cwd='/workspaces/research_'+data.ids[0];
 const pane=()=>dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','tmux','list-panes','-t',sessionName+':0','-F','#{pane_pid}:#{pane_current_path}');
 const first=await pane();assert(first.endsWith(cwd),`Pane observed ${JSON.stringify(first)}, expected cwd ${cwd}`);for(let n=0;n<3;n++){await page.reload();await page.getByText('Terminal: connected',{exact:true}).waitFor();assert.equal(await pane(),first);}
 let running=false;for(let i=0;i<50;i++){const ps=await dexec('ps','-eo','user:20,args');running=ps.split('\n').some(l=>l.includes('researcher')&&l.includes('codex')&&l.includes('--yolo'));if(running)break;await wait(200);}assert(running,'Native Codex must run as researcher with --yolo');
 const codexConfig=await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','sh','-c',`cd ${cwd} && bughunter-codex mcp get bughunter_burp --json`);assert(codexConfig.includes('bughunter-burp-mcp'));
 const skills=JSON.parse(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','sh','-c',`cd ${cwd} && node --input-type=module -e 'import {codexRead} from "/opt/bughunter/docker/research/validator/codex-rpc.mjs";console.log(JSON.stringify(await codexRead("skills/list",{cwds:[process.cwd()],forceReload:true})));'`));
 for(const name of ['web-security-testing','api-fuzzing-bug-bounty','idor-testing','ffuf-web-fuzzing'])assert(skills.data.some(group=>group.skills.some(s=>s.name===name)),`Codex did not discover ${name}`);
 await dexec('sh','-c','cd /etc/codex/skills && sha256sum --check ../skills.sha256');
 // Both providers run as native CLIs in the final runner, without model credentials.
 // Exercise selection and reconnection through the same real WebSocket/PTY protocol.
 await page.getByLabel('Moteur IA',{exact:true}).selectOption('claude');
 await page.getByRole('button',{name:'Open Claude Code',exact:true}).click();
 await page.getByText('Claude: login required',{exact:true}).waitFor({timeout:30000});
 await page.getByText('Terminal: connected',{exact:true}).waitFor();
 assert.match(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','claude','--version'),/^2\.1\.312 \(Claude Code\)$/);
 const claudeSession='bughunter_claude_'+data.ids[0];
 const claudePane=()=>dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','tmux','list-panes','-t',claudeSession+':0','-F','#{pane_pid}:#{pane_current_path}');
 const claudeFirst=await claudePane();assert(claudeFirst.endsWith(cwd));
 // Native structured initialization verifies CLI MCP loading without a model login.
 // Print mode has no session persistence and first asserts the disposable login is absent.
 const nativeClaude=JSON.parse(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','node','--input-type=module','-e',`
   import {spawnSync} from 'node:child_process';import {claudeArguments,claudeConfigDirectory} from '/opt/bughunter/docker/research/validator/claude-config.mjs';
   const cwd=${JSON.stringify(cwd)},env={...process.env,CLAUDE_CONFIG_DIR:claudeConfigDirectory(cwd),DISABLE_AUTOUPDATER:'1'};
   const auth=spawnSync('claude',['auth','status'],{cwd,env,encoding:'utf8'});if(JSON.parse(auth.stdout).loggedIn!==false)throw new Error('Disposable unauthenticated CLI required');
   const result=spawnSync('claude',['Describe local configuration only.',...claudeArguments(cwd,'Passive local configuration check only.'),'-p','--no-session-persistence','--output-format','stream-json','--verbose','--max-turns','1'],{cwd,env,timeout:30000,maxBuffer:524288,encoding:'utf8'});
   const events=result.stdout.split('\\n').filter(Boolean).map(line=>JSON.parse(line)),init=events.find(e=>e.type==='system'&&e.subtype==='init');
   console.log(JSON.stringify({exitCode:result.status,mcp:init?.mcp_servers,tools:init?.tools,error:events.some(e=>e.is_error)}));
 `));
 assert.equal(nativeClaude.exitCode,1);assert.equal(nativeClaude.error,true,'Missing auth must fail rather than claim successful inference');
 assert(nativeClaude.mcp.some(server=>server.name==='bughunter_burp'&&server.status==='connected'));
 assert(nativeClaude.tools.includes('mcp__bughunter_burp__burp_status'));assert(!nativeClaude.tools.includes('Bash'));assert(!nativeClaude.tools.some(name=>name.includes('send_http')));
 console.log('CLAUDE MCP LOADING VERIFIED: real native stream-json initialization discovers the configured passive bridge and tools; missing authentication fails inference without persisting a probe conversation.');

 const selected=await page.evaluate(async id=>(await (await fetch(`/api/research-targets/${id}/terminal`,{method:'POST'})).json()).provider,data.ids[0]);
 assert.equal(selected,'claude');
 await page.reload();await page.getByText('Claude: login required',{exact:true}).waitFor({timeout:30000});assert.equal(await claudePane(),claudeFirst);
 assert.equal(await pane(),first,'Switching providers must retain the original Codex pane');
 const passive=new Client({name:'claude-passive-configuration-test',version:'1.0.0'});
 await passive.connect(new StdioClientTransport({command:'docker',args:['exec','-i','-u','researcher','-w',cwd,consoleId,'bughunter-burp-passive-mcp'],stderr:'pipe'}));
 try {
   assert.deepEqual((await passive.listTools()).tools.map(tool=>tool.name),['burp_status','burp_history','burp_save_observation']);
   assert.equal((await passive.callTool({name:'send_http1_request',arguments:{}})).isError,true,'Passive relay must reject unadvertised active calls');
   assert((await passive.callTool({name:'burp_status',arguments:{}})).content.some(block=>block.type==='text'&&JSON.parse(block.text).configuration==='CONFIGURED'));
 } finally {await passive.close();}
 await page.getByLabel('Moteur IA',{exact:true}).selectOption('codex');await page.getByRole('button',{name:'Open Codex CLI',exact:true}).click();
 await page.getByText('Codex: login required',{exact:true}).waitFor({timeout:30000});assert.equal(await pane(),first);
 console.log('PROVIDERS VERIFIED: pinned native Claude/Codex binaries, real browser selection/persistence, distinct persistent PTYs, reconnect, absent authentication, passive MCP tool inventory and server-side active-call refusal. No model inference or Claude security skills validated.');
 const ticket=await page.evaluate(async id=>{const r=await fetch(`/api/research-targets/${id}/terminal`,{method:'POST'});return r.json();},data.ids[0]);
 const denied=(id,token,wrongOrigin=false,appHeaders=false)=>new Promise(resolve=>{const ws=new WebSocket(`ws://127.0.0.1:${terminalPort}/research-terminal/${id}`,token?['bh-terminal.v1','ticket.'+token]:['bh-terminal.v1'],{origin:wrongOrigin?'http://foreign.example.test':origin,...(appHeaders?{headers:{Cookie:'SYNTHETIC_AUTH_COOKIE',Authorization:'Bearer SYNTHETIC_AUTH_HEADER'}}:{})});ws.on('unexpected-response',(_req,r)=>{r.resume();resolve(r.statusCode);});ws.on('open',()=>{ws.close();resolve(101);});ws.on('error',()=>{});});
 assert.equal(await denied(data.ids[0]),401);assert.equal(await denied(data.ids[0],ticket.token+'x'),401);assert.equal(await denied(data.ids[0],ticket.token,true),401);assert.equal(await denied(data.ids[0],ticket.token,false,true),401);assert.equal(await denied(data.ids[1],ticket.token),401);
 const replayTicket=await page.evaluate(async id=>(await fetch(`/api/research-targets/${id}/terminal`,{method:'POST'})).json(),data.ids[0]);assert.equal(await denied(data.ids[0],replayTicket.token),101);assert.equal(await denied(data.ids[0],replayTicket.token),401);
 const expired=issueTerminalTicket({targetId:data.ids[0],userId:data.userId,sessionId:'expired-session',policySha256:'a'.repeat(64)},privateKey,Date.now()-60000);assert.equal(await denied(data.ids[0],expired.token),401);
 await page.goto(origin+`/research/${data.ids[1]}`);await page.getByText('Terminal: connected',{exact:true}).waitFor();const second=await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','tmux','list-panes','-t','bughunter-'+data.ids[1]+':0','-F','#{pane_pid}:#{pane_current_path}');assert.notEqual(second,first);
 await webScript(`import {PrismaClient} from '@prisma/client';const p=new PrismaClient();const t=await p.target.findUniqueOrThrow({where:{id:${JSON.stringify(data.ids[0])}}});await p.scope.update({where:{id:t.scopeId},data:{status:'REVOKED'}});console.log('{}');await p.$disconnect();`);
 const rejected=await page.evaluate(async id=>(await fetch(`/api/research-targets/${id}/terminal`,{method:'POST'})).status,data.ids[0]);assert.equal(rejected,400);
 const inspected=JSON.parse(await run('docker',['inspect',consoleId]))[0];assert(inspected.NetworkSettings.Ports['22/tcp'].every(p=>p.HostIp==='127.0.0.1'));assert(!JSON.stringify(inspected.Config.Env).match(/AUTH_SECRET|DATABASE_URL|REDIS_URL|CREDENTIALS_ENCRYPTION_KEY/));assert(!JSON.stringify(inspected.Mounts).includes('docker.sock'));assert(!inspected.HostConfig.Privileged);
 const dbId=await compose('ps','-q','db'),redisId=await compose('ps','-q','redis');for(const [id,port] of [[dbId,5432],[redisId,6379]]){const ip=JSON.parse(await run('docker',['inspect',id]))[0].NetworkSettings.Networks[prefix+'_backend'].IPAddress;await assert.rejects(dexec('node','-e',`const s=require('net').connect(${port},'${ip}',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1000);`));}
 console.log('CONSOLE VERIFIED: real xterm/browser/auth tickets, PTY/Codex --yolo, same tmux across refreshes, distinct target sessions, scope revoke, non-root/no app secrets/socket/backend access, exact Codex skill discovery.');
 await verifyConsoleClipboard({page,context,dexec,targetId:data.ids[1]});
 // Burp and Playwright wire checks are below; their fixture never contacts the Internet.
 const targetRequests=[], proxyConnections=[];
 targetFixture=createServer((req,res)=>{targetRequests.push({url:req.url,ua:req.headers['user-agent'],host:req.headers.host});if(req.url==='/timeout')return;if(req.url==='/redirect'){res.writeHead(302,{Location:'http://foreign.example.test/never'}).end();return;}res.writeHead(200,{'Content-Type':'text/html','Set-Cookie':'sid=LOCAL_SENSITIVE_COOKIE'}).end('<html><h1>Local target fixture</h1></html>');});await new Promise(r=>targetFixture.listen(0,'127.0.0.1',r));
 proxyFixture=createServer((req,res)=>{const url=new URL(req.url);const upstream=request({host:'127.0.0.1',port:targetFixture.address().port,path:url.pathname+url.search,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>res.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);});proxyFixture.on('connect',(req,client,head)=>{proxyConnections.push(req.url);if(req.url!=='browser.example.test:80'){client.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}const upstream=netConnect(targetFixture.address().port,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());});await new Promise(r=>proxyFixture.listen(0,'127.0.0.1',r));
 fixture=await fakeBurp({activeCall:async ({name,arguments:a})=>{if(a.content?.includes('/timeout'))return new Promise(()=>{});const ua=name==='send_http1_request'?/^User-Agent: (.+)$/mi.exec(a.content)?.[1].trim():a.headers['user-agent'];const r=await fetch(`http://127.0.0.1:${targetFixture.address().port}/active`,{headers:{'user-agent':ua}});return {content:[{type:'text',text:`HTTP/1.1 ${r.status} OK\nSet-Cookie: sid=LOCAL_SENSITIVE_COOKIE\n\nLocal observed data`}]};}});
 const sshArgs=['-i',join(temp,'ssh'),'-p',String(sshPort),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new','-o',`UserKnownHostsFile=${join(temp,'known_hosts')}`];
 tunnel=spawn('ssh',[...sshArgs,'-NT','-o','ExitOnForwardFailure=yes','-R',`127.0.0.1:9876:127.0.0.1:${fixture.port}`,'-R',`127.0.0.1:8080:127.0.0.1:${proxyFixture.address().port}`,'researcher@127.0.0.1'],{stdio:'ignore'});await wait(600);
 const connectMcp=async(id,command)=>{const client=new Client({name:'local-console-verification',version:'1.0.0'});await client.connect(new StdioClientTransport({command:'ssh',args:[...sshArgs,'researcher@127.0.0.1',`cd /workspaces/research_${id} && ${command}`],stderr:'pipe'}));return client;};
 // Separate official inventory: reconnect must replace Java and rediscover tools.
 let official=await connectMcp(data.ids[1],'bughunter-portswigger-mcp');
 const expectedInventory=[...fixture.inventory]; assert.equal((await official.listTools()).tools.length,5);
 for(const inventory of [[],['burp_status','burp_history','burp_save_observation']]) {
   fixture.inventory.splice(0,fixture.inventory.length,...inventory);
   await page.getByRole('button',{name:'Reconnect',exact:true}).click();
   await page.getByText('Burp MCP: unavailable',{exact:true}).waitFor({timeout:45000});
   assert.equal((await official.listTools()).tools.length,0);
 }
 fixture.inventory.splice(0,fixture.inventory.length,...expectedInventory);
 await page.getByRole('button',{name:'Reconnect',exact:true}).click();
 await page.getByText('Burp MCP: connected',{exact:true}).waitFor({timeout:45000});
 assert.equal((await official.listTools()).tools.length,5);
 await official.close();
 console.log('PortSwigger diagnostics verified: absent, zero tools, internal wrappers incompatible; reconnect rediscovers official inventory without replacing tmux.');
 mcp=await connectMcp(data.ids[1],'bughunter-burp-mcp');let tools=await mcp.listTools();assert(tools.tools.some(t=>t.name==='send_http2_request'));
 const base={targetHostname:'browser.example.test',targetPort:80,usesHttps:false};
 for(const ua of ['', 'User-Agent: incorrect\r\n']){const sent=await mcp.callTool({name:'send_http1_request',arguments:{...base,content:`GET /active HTTP/1.1\r\nHost: browser.example.test\r\n${ua}\r\n`}});assert(!sent.isError,JSON.stringify(sent));assert(!JSON.stringify(sent).includes('LOCAL_SENSITIVE_COOKIE'));}
 const http2=await mcp.callTool({name:'send_http2_request',arguments:{...base,pseudoHeaders:{':authority':'browser.example.test',':scheme':'http',':method':'GET',':path':'/active'},headers:{'User-Agent':'wrong'},requestBody:''}});assert(!http2.isError,JSON.stringify(http2));
 const n=fixture.calls.length;assert((await mcp.callTool({name:'send_http1_request',arguments:{...base,targetHostname:'foreign.example.test',content:'GET / HTTP/1.1\r\nHost: foreign.example.test\r\n\r\n'}})).isError);assert.equal(fixture.calls.length,n);
 const began=Date.now();const timeout=await mcp.callTool({name:'send_http1_request',arguments:{...base,content:'GET /timeout HTTP/1.1\r\nHost: browser.example.test\r\n\r\n'}},undefined,{timeout:22000});assert(timeout.isError);assert(JSON.stringify(timeout).includes('TIMEOUT'));assert(Date.now()-began<21000);assert.equal(targetRequests.filter(r=>r.url==='/timeout').length,1,'No automatic active replay');assert(!fixture.calls.some(c=>c.name==='send_http1_request'),'HTTP/1 must traverse the real proxy transport, not Montoya');
 await mcp.close();mcp=await connectMcp(data.ids[1],'bughunter-playwright-mcp');tools=await mcp.listTools();assert(tools.tools.some(t=>t.name==='browser_navigate'));
 const navigated=await mcp.callTool({name:'browser_navigate',arguments:{url:'http://browser.example.test/'}});assert(!navigated.isError,JSON.stringify(navigated).slice(0,1000));
 await mcp.callTool({name:'browser_navigate',arguments:{url:'http://browser.example.test/redirect'}});
 assert(targetRequests.length>=4);assert(targetRequests.every(r=>r.ua==='Research-Test/1'));assert(!targetRequests.some(r=>r.host==='foreign.example.test'));assert(proxyConnections.every(host=>host==='browser.example.test:80'),JSON.stringify(proxyConnections));
 await mcp.close();mcp=null;
 // A global console works without any host and exposes actual Codex-discovered MCP tools.
 const globalProgram=await page.evaluate(async()=>{const r=await fetch('/api/programs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyName:'Global empty program',requiredUserAgent:'Research-Test/1',scopeRules:['*.example.test'],outOfScope:['admin.example.test'],rulesOfEngagement:'Passive only; no destructive tests.'})});if(!r.ok)throw new Error(await r.text());return r.json();});
 await page.goto(origin+'/targets/'+globalProgram.id);const openGlobal=async()=>{const id=await page.evaluate(async programId=>{const r=await fetch('/api/programs/'+programId+'/context',{method:'POST'});if(!r.ok)throw new Error(await r.text());return(await r.json()).contextId;},globalProgram.id);await page.goto(origin+'/research/'+id);};await openGlobal();await page.getByText('Terminal: connected',{exact:true}).waitFor({timeout:30000});
 const globalContext=await webScript(`import {PrismaClient} from '@prisma/client';const p=new PrismaClient();const t=await p.target.findFirstOrThrow({where:{programId:${JSON.stringify(globalProgram.id)},contextOnly:true}});console.log(JSON.stringify({id:t.id,hosts:await p.target.count({where:{programId:t.programId,contextOnly:false}})}));await p.$disconnect();`);assert.equal(globalContext.hosts,0);
 const globalCwd='/workspaces/research_'+globalContext.id;
 mcp=await connectMcp(globalContext.id,'bughunter-burp-mcp');assert.deepEqual((await mcp.listTools()).tools.map(t=>t.name),['burp_status','burp_history','burp_save_observation']);
 assert.equal(JSON.parse((await mcp.callTool({name:'burp_status',arguments:{}})).content[0].text).upstream,'AVAILABLE');
 assert(!(await mcp.callTool({name:'burp_history',arguments:{host:'app.example.test',count:1,offset:0}})).isError);
 const previous=fixture.calls.length;assert((await mcp.callTool({name:'burp_history',arguments:{host:'admin.example.test'}})).isError);assert((await mcp.callTool({name:'send_http1_request',arguments:{...base,content:'GET / HTTP/1.1\r\nHost: browser.example.test\r\n\r\n'}})).isError);assert.equal(fixture.calls.length,previous);
 await mcp.close();mcp=null;
 for(const id of [data.ids[1],globalContext.id]){
   const discovered=JSON.parse(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','sh','-c',`cd /workspaces/research_${id} && node --input-type=module -e 'import {codexRead} from "/opt/bughunter/docker/research/validator/codex-rpc.mjs";console.log(JSON.stringify(await codexRead("mcpServerStatus/list",{serverName:"bughunter_burp"},process.cwd(),20000,true)));'`));
   const server=discovered.data.find(s=>s.name==='bughunter_burp');assert(server,'Codex app-server must discover Burp MCP');assert(JSON.stringify(server.tools).includes('burp_status'),JSON.stringify(discovered));
 }
 // Start through the target API, then inject a controlled worker discovery (no Internet Recon).
 await page.goto(origin+'/targets/'+globalProgram.id);
 const startedRecon=page.waitForResponse(r=>r.url().endsWith('/programs/'+globalProgram.id+'/recon')&&r.request().method()==='POST');await page.getByRole('button',{name:'Recon',exact:true}).click();const queuedResponse=await startedRecon;assert.equal(queuedResponse.status(),202);const batch=await queuedResponse.json(),queued={id:batch.scans[0].id};
 reconWorker=spawn('docker',['compose','-p',prefix,'-f',config,'exec','-T','-e','BH_DISPOSABLE_CONSOLE=1','-e','BH_TEST_RUN_ID='+queued.id,'web','node','--import','tsx','tests/research/holdProgramRecon.mts'],{stdio:['ignore','pipe','pipe']});let workerOutput='';reconWorker.stdout.on('data',chunk=>workerOutput+=chunk);reconWorker.stderr.on('data',()=>{});
 for(let i=0;!workerOutput.includes('CONTROLLED_RECON_RUNNING');i++){if(i===100)throw new Error('Controlled Recon did not start: '+workerOutput);await wait(100);}
 const controlledAsset=await webScript(`import {PrismaClient} from '@prisma/client';import {persistProgramDiscovery} from '/app/src/server/recon/program.ts';const p=new PrismaClient();await persistProgramDiscovery(${JSON.stringify(queued.id)},'api.example.test','CONTROLLED_FIXTURE');const r=await p.scanRun.findUniqueOrThrow({where:{id:${JSON.stringify(queued.id)}},include:{scopeAsset:true}});const {recordArtifact}=await import('/app/src/server/recon/artifacts.ts');await recordArtifact(r.id,r.scopeAsset,[],'hostname',{hostname:'api.example.test'},{tool:'controlled-fixture',sourceRef:'controlled:host',observedAt:new Date().toISOString()});await recordArtifact(r.id,r.scopeAsset,[],'endpoint',{url:'https://app.example.test/'},{tool:'controlled-fixture',sourceRef:'controlled:http',observedAt:new Date().toISOString()},'OBSERVED');console.log(JSON.stringify({assetId:r.scopeAssetId}));await p.$disconnect();`);
 const collected=await webScript(`const {collectOwnedRunBurp}=await import('/app/src/server/recon/burpCollection.ts');const result=await collectOwnedRunBurp(${JSON.stringify(queued.id)});console.log(JSON.stringify(result));`);assert.equal(collected.status,'AVAILABLE');assert(collected.observations.length>0);assert(collected.observations[0].requestRef.startsWith('BurpRequest:'));assert(!JSON.stringify(collected).includes('FIXTURE_SECRET')&&!JSON.stringify(collected).includes('COOKIE_SECRET'));console.log('PASSIVE_RECON_BURP_COLLECTION_PASSED: signed web → console control → local SSE history fixture, references and secret redaction; no active replay.');
 await page.goto(origin+'/scopes/'+controlledAsset.assetId);await page.getByRole('heading',{name:'Hosts and services',exact:true}).waitFor();await page.getByText('api.example.test',{exact:true}).waitFor();
 await page.goto(origin+'/targets/'+globalProgram.id);await openGlobal();await page.getByText('Terminal: connected',{exact:true}).waitFor();
 await page.getByLabel('Moteur IA',{exact:true}).selectOption('claude');await page.getByRole('button',{name:'Open Claude Code',exact:true}).click();await page.getByText('Claude: login required',{exact:true}).waitFor({timeout:30000});
 const globalClaudeConfig='/home/researcher/.claude/workspaces/'+globalContext.id;await dexec('test','-d',globalClaudeConfig);
 const inventory=JSON.parse(await dexec('cat',globalCwd+'/recon/hosts.json'));assert.equal(inventory.hosts[0].host,'api.example.test');
 // Actual running Recon, native Codex and a real workspace child
 // running in this workspace must be stopped before the UI deletion succeeds.

 const nativeThread=JSON.parse(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','sh','-c',`cd ${globalCwd} && node --input-type=module -e 'import {codexRead} from "/opt/bughunter/docker/research/validator/codex-rpc.mjs";console.log(JSON.stringify(await codexRead("thread/inject_items",{items:[{type:"message",role:"user",content:[{type:"input_text",text:"Synthetic local history fixture; no model request."}]}]},process.cwd(),15000,"persistent")));'`));
 assert(nativeThread.thread.id);
 const countNativeThread=async()=>Number(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','python3','-c',"import os,sqlite3,sys; c=sqlite3.connect('file:'+os.environ['CODEX_HOME']+'/state_5.sqlite?mode=ro',uri=True); print(c.execute('SELECT count(*) FROM threads WHERE id=?',(sys.argv[1],)).fetchone()[0])",nativeThread.thread.id));
 assert.equal(await countNativeThread(),1,'Native history fixture must exist before deletion');
 const childPid=await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','sh','-c',`cd ${globalCwd} && sleep 300 >/dev/null 2>&1 & echo $!`);
 await page.goto(origin+'/targets/'+globalProgram.id+'/settings');await page.getByText('Delete Target',{exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete Target permanently',exact:true}).click();
 try{await page.waitForURL(origin+'/targets?deleted=1',{timeout:40000});}catch(e){console.error('Deletion UI:',await page.locator('body').innerText());console.error(await compose('logs','--tail','20','research-console'));throw e;}
 assert.equal(await countNativeThread(),0,'Native Codex history must be permanently deleted');
 await assert.rejects(dexec('test','-e',globalClaudeConfig));
 await assert.rejects(dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','tmux','has-session','-t','=bughunter_claude_'+globalContext.id));
 await dexec('test','-d','/home/researcher/.claude/workspaces/'+data.ids[0]);
 await assert.rejects(dexec('test','-e',globalCwd));await assert.rejects(dexec('kill','-0',childPid));
 await assert.rejects(dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','tmux','has-session','-t','=bughunter-'+globalContext.id));
 // Shared upstream and the other target console are still usable.
 mcp=await connectMcp(data.ids[1],'bughunter-burp-mcp');assert.equal(JSON.parse((await mcp.callTool({name:'burp_status',arguments:{}})).content[0].text).upstream,'AVAILABLE');
 assert(workerOutput.includes('CONTROLLED_RECON_STOPPED'));if(reconWorker.exitCode===null)await new Promise(resolve=>reconWorker.once('exit',resolve));reconWorker=null;
 await page.goto(origin+'/research/'+data.ids[1]);await page.getByText('Terminal: connected',{exact:true}).waitFor();
 console.log('PROGRAM VERIFIED: no-host console, native Codex MCP tool discovery for host/program, incremental inventory, passive policy, UI deletion of running Recon + Codex/child, workspace removal and shared upstream preservation.');
 await mcp.close();mcp=null;tunnel.kill('SIGTERM');tunnel=null;await fixture.close();fixture=null;
 const offline=await connectMcp(data.ids[1],'bughunter-burp-mcp');assert((await offline.listTools()).tools.length>=5);const missingMcp=await offline.callTool({name:'burp_history',arguments:{count:1,offset:0}});assert(missingMcp.isError);assert.equal(JSON.parse(missingMcp.content[0].text).code,'BURP_MCP_UNAVAILABLE');assert.equal(JSON.parse(missingMcp.content[0].text).remoteStatus,null);await offline.close();
 const unchanged=await webScript(`import {PrismaClient} from '@prisma/client';const p=new PrismaClient();console.log(JSON.stringify({findings:await p.finding.count(),reports:await p.report.count(),scans:await p.scanRun.count()}));await p.$disconnect();`);assert.deepEqual(unchanged,{findings:0,reports:0,scans:0});
 await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','curl','-fsS','--max-time','8','-o','/dev/null','https://registry.npmjs.org/@openai/codex/latest');
 await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','sh','-c',`printf '%s' 'Restart persistence fixture' > /workspaces/research_${data.ids[1]}/findings/restart-note.txt`);
 await page.getByLabel('Moteur IA',{exact:true}).selectOption('claude');await page.getByRole('button',{name:'Open Claude Code',exact:true}).click();await page.getByText('Claude: login required',{exact:true}).waitFor({timeout:30000});
 const claudePersistFile='/home/researcher/.claude/workspaces/'+data.ids[1]+'/persistence-fixture';
 await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','node','-e',"require('fs').writeFileSync(process.argv[1],'Claude persistence fixture')",claudePersistFile);
 await page.getByLabel('Moteur IA',{exact:true}).selectOption('codex');await page.getByRole('button',{name:'Open Codex CLI',exact:true}).click();await page.getByText('Codex: login required',{exact:true}).waitFor({timeout:30000});
 await compose('restart','research-console');
 for(let i=0;i<60;i++){try{await dexec('console-healthcheck');break;}catch{if(i===59)throw new Error('Restarted console unhealthy');await wait(200);}}
 await assert.rejects(dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','tmux','has-session','-t','=bughunter-'+data.ids[1]));
 assert.equal(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','cat',`/workspaces/research_${data.ids[1]}/findings/restart-note.txt`),'Restart persistence fixture');
 await page.reload();await page.getByText('Terminal: connected',{exact:true}).waitFor({timeout:30000});
 assert((await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','tmux','list-panes','-t','bughunter-'+data.ids[1]+':0','-F','#{pane_current_path}')).endsWith('/workspaces/research_'+data.ids[1]));
 await page.getByLabel('Moteur IA',{exact:true}).selectOption('claude');await page.getByRole('button',{name:'Open Claude Code',exact:true}).click();await page.getByText('Claude: login required',{exact:true}).waitFor({timeout:30000});
 assert.equal(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','cat',claudePersistFile),'Claude persistence fixture');
 await page.getByLabel('Moteur IA',{exact:true}).selectOption('codex');await page.getByRole('button',{name:'Open Codex CLI',exact:true}).click();await page.getByText('Codex: login required',{exact:true}).waitFor({timeout:30000});
 console.log('Restart verified: persisted workspace/Codex home, new tmux on attach, same Target CWD; no browser refresh killed the prior session.');
 console.log('MCP/PROXY VERIFIED: HTTP/1 bridge → loopback proxy → local target; bounded official SSE for legacy cleartext HTTP/2/history; policy/UA/redaction/timeout/no replay; real Playwright with blocked cross-host redirect. This mock phase performs no model inference; genuine Burp acceptance follows when enabled.');
 if (process.env.RESEARCH_REAL_BURP_IMAGE) await portSwiggerAcceptance({image:process.env.RESEARCH_REAL_BURP_IMAGE,runnerImage:service.image,prefix,consoleId,run,dexec,connectMcp,page,origin,hostId:data.ids[1],wait,webScript});
 // Archive pauses both real provider PTYs and preserves workspace/history.
 const archiveCwd='/workspaces/research_'+data.ids[1];
 const retainedThread=JSON.parse(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','sh','-c',`cd ${archiveCwd} && node --input-type=module -e 'import {codexRead} from "/opt/bughunter/docker/research/validator/codex-rpc.mjs";console.log(JSON.stringify(await codexRead("thread/inject_items",{items:[{type:"message",role:"user",content:[{type:"input_text",text:"Archive preservation fixture; no model request."}]}]},process.cwd(),15000,"persistent")));'`));assert(retainedThread.thread.id);
 await webScript(`import {prisma} from '/app/src/lib/prisma.ts';import {lockOwnedProgram,backfillProgramAssets,editScopeAsset} from '/app/src/server/scopeAssets.ts';const t=await prisma.target.findUniqueOrThrow({where:{id:${JSON.stringify(data.ids[1])}}});await prisma.$transaction(async tx=>{await lockOwnedProgram(tx,t.userId,t.programId);await backfillProgramAssets(tx,t.programId,t.userId);});const current=await prisma.target.findUniqueOrThrow({where:{id:t.id}});await editScopeAsset(t.userId,t.programId,current.scopeAssetId,null);console.log('{}');await prisma.$disconnect();`);
 for(const name of ['bughunter-'+data.ids[1],'bughunter_claude_'+data.ids[1]])await assert.rejects(dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','tmux','has-session','-t','='+name));
 assert.equal(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','cat',archiveCwd+'/findings/restart-note.txt'),'Restart persistence fixture');assert.equal(await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','cat',claudePersistFile),'Claude persistence fixture');
 const retainedCount=await dexec('setpriv','--reuid=researcher','--regid=research','--init-groups','python3','-c',"import os,sqlite3,sys; c=sqlite3.connect('file:'+os.environ['CODEX_HOME']+'/state_5.sqlite?mode=ro',uri=True); print(c.execute('SELECT count(*) FROM threads WHERE id=?',(sys.argv[1],)).fetchone()[0])",retainedThread.thread.id);assert.equal(Number(retainedCount),1);
 console.log('ARCHIVE_NATIVE_PRESERVATION_PASSED: both provider tmux sessions stopped, Codex thread, Claude state and workspace files retained.');
 console.log(await run(process.execPath,['tests/e2e/targetWorkflow.mjs'],{env:{...process.env,TEST_APP_URL:origin},timeout:90000}));
} finally {
 reconWorker?.kill('SIGTERM');
 await mcp?.close().catch(()=>{});tunnel?.kill('SIGTERM');await fixture?.close().catch(()=>{});await browser?.close();
 for(const s of [ingress,proxyFixture,targetFixture])if(s){s.closeAllConnections?.();await new Promise(r=>s.close(r));}
 if(started)await compose('down','-v','--remove-orphans');await rm(temp,{recursive:true,force:true});
}
