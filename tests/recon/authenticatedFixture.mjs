// Local controlled application only. The observations intentionally retain no
// passwords, cookie values, bearer values, request bodies or personal data.
import {createServer} from 'node:http';
import {createSocket} from 'node:dgram';
import {networkInterfaces} from 'node:os';
import {pathToFileURL} from 'node:url';

export const fixtureAccounts={
  user:{username:'fixture-user',password:'FIXTURE_ONLY_USER_PASSWORD',cookie:'FIXTURE_ONLY_USER_COOKIE',bearer:'FIXTURE_ONLY_USER_BEARER',id:'fixture-identity-user'},
  manager:{username:'fixture-manager',password:'FIXTURE_ONLY_MANAGER_PASSWORD',cookie:'FIXTURE_ONLY_MANAGER_COOKIE',bearer:'FIXTURE_ONLY_MANAGER_BEARER',id:'fixture-identity-manager'},
  temporary:{username:'fixture-temporary',password:'FIXTURE_ONLY_TEMP_PASSWORD',cookie:'FIXTURE_ONLY_TEMP_COOKIE',bearer:'FIXTURE_ONLY_TEMP_BEARER',id:'fixture-identity-temporary'},
};
export async function startAuthenticatedFixture({port=8081,host='0.0.0.0',dnsPort=null}={}){
  const observations=[],expired=new Set();let dns;
  const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const app=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://'+req.headers.host);
    if(url.pathname==='/__observations')return json(res,observations);
    if(url.pathname==='/__control'){
      let body='';for await(const chunk of req)body+=chunk;
      const command=JSON.parse(body||'{}');if(command.expire)expired.add(command.expire);if(command.restore)expired.delete(command.restore);
      return json(res,{ok:true});
    }
    const role=Object.entries(fixtureAccounts).find(([,a])=>String(req.headers.cookie??'').split(';').some(pair=>pair.trim()==='fixture_session='+a.cookie)||req.headers.authorization==='Bearer '+a.bearer)?.[0]??null;
    const validRole=role&&!expired.has(role)?role:null;
    observations.push({host:String(req.headers.host),path:url.pathname,method:req.method,role:validRole,hasCookie:Boolean(req.headers.cookie),hasAuthorization:Boolean(req.headers.authorization),ua:String(req.headers['user-agent']??'')});
    if(!String(req.headers.host).startsWith('auth.fixture.test:'))return json(res,{error:'Foreign host trap'},418);
    if(!url.pathname.startsWith('/app/'))return json(res,{error:'Outside authorized path trap'},418);
    res.setHeader('Server','Controlled-Auth-Fixture');
    if(req.method==='POST'){
      if(url.pathname!=='/app/login')return json(res,{error:'Mutation trap'},418);
      let raw='';for await(const chunk of req)raw+=chunk;
      const values=new URLSearchParams(raw),entry=Object.entries(fixtureAccounts).find(([,a])=>a.username===values.get('username')&&a.password===values.get('password'));
      if(!entry)return json(res,{error:'Invalid test login'},401);
      expired.delete(entry[0]);res.setHeader('Set-Cookie','fixture_session='+entry[1].cookie+'; Path=/app/; HttpOnly; SameSite=Lax; Max-Age=1200');
      res.writeHead(303,{Location:'/app/profile'});return res.end();
    }
    if(!['GET','HEAD'].includes(req.method))return json(res,{error:'Method trap'},418);
    const links='<a href="/app/public">Public</a><a href="/app/login">Login</a><a href="/app/profile">Profile</a><a href="/app/dashboard">Dashboard</a><a href="/app/admin">Admin</a><a href="/app/api/me">Session</a><a href="/app/foreign-redirect">External redirect</a><a href="/app/sibling-redirect">Sibling redirect</a><a href="http://foreign.fixture.test:'+port+'/app/private">External endpoint</a><a href="/outside">Outside path</a><a href="/app/logout">Logout</a><a href="/app/delete">Delete</a><form action="/app/transfer" method="POST"><input name="amount"></form>';
    // Deliberate controlled traps: the guarded browser must stop these before
    // network traffic, even though the public page contains executable JS.
    const traps='<script>fetch("/app/transfer",{method:"POST",body:"controlled=1"}).catch(()=>{});fetch("/app/logout").catch(()=>{});fetch("http://foreign.fixture.test:'+port+'/app/private").catch(()=>{});try{new WebSocket("ws://sibling.fixture.test:'+port+'/app/socket")}catch{}</script>';
    if(url.pathname==='/app/foreign-redirect'||url.pathname==='/app/sibling-redirect'){
      res.writeHead(302,{Location:'http://'+(url.pathname.includes('sibling')?'sibling':'foreign')+'.fixture.test:'+port+'/app/private'});return res.end();
    }
    if(['/app/logout','/app/delete','/app/transfer'].includes(url.pathname))return json(res,{error:'Action trap'},418);
    if(url.pathname==='/app/login'){
      res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><title>Fixture login</title><form action="/app/login" method="POST"><input name="username" autocomplete="username"><input name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>');
    }
    if(url.pathname==='/app/'||url.pathname==='/app/public'){
      res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><title>Public fixture surface</title>'+links+traps);
    }
    if(['/app/api/me','/app/profile','/app/dashboard','/app/admin','/app/private'].includes(url.pathname)){
      if(!validRole){res.writeHead(307,{Location:'/app/login?callbackUrl='+encodeURIComponent(url.pathname)});return res.end();}
      if(url.pathname==='/app/admin'&&validRole!=='manager')return json(res,{error:'Forbidden to this fixture identity'},403);
      if(url.pathname==='/app/profile'||url.pathname==='/app/api/me')return json(res,{authenticated:true,user:{id:fixtureAccounts[validRole].id},links:['/app/dashboard','/app/admin']});
      res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><title>Authenticated fixture surface</title><main data-authenticated="true">'+links+'</main>');
    }
    return json(res,{error:'Not found'},404);
  });
  app.on('upgrade',(req,socket)=>{observations.push({host:String(req.headers.host),path:new URL(req.url,'http://'+req.headers.host).pathname,method:'WEBSOCKET',role:null,hasCookie:Boolean(req.headers.cookie),hasAuthorization:Boolean(req.headers.authorization),ua:String(req.headers['user-agent']??'')});socket.destroy();});
  await new Promise(resolve=>app.listen(port,host,resolve));
  if(dnsPort!==null){
    const ip=Object.values(networkInterfaces()).flat().find(n=>n.family==='IPv4'&&!n.internal)?.address;
    if(!ip)throw new Error('Internal fixture DNS requires IPv4');dns=createSocket('udp4');
    dns.on('message',(query,peer)=>{
      if(query.length<17||query.readUInt16BE(4)!==1)return;let at=12;const labels=[];
      while(at<query.length&&query[at]){const size=query[at++];if(size>63||at+size>query.length)return;labels.push(query.subarray(at,at+size).toString('ascii'));at+=size;}
      if(at+5>query.length)return;at++;const type=query.readUInt16BE(at);at+=4;const known=['auth.fixture.test','foreign.fixture.test','sibling.fixture.test'].includes(labels.join('.'));
      const answer=known&&type===1,header=Buffer.alloc(12);query.copy(header,0,0,2);header.writeUInt16BE(0x8480|(query.readUInt16BE(2)&0x0100)|(known?0:3),2);header.writeUInt16BE(1,4);header.writeUInt16BE(answer?1:0,6);
      const record=answer?Buffer.from([0xc0,0x0c,0,1,0,1,0,0,0,30,0,4,...ip.split('.').map(Number)]):Buffer.alloc(0);dns.send(Buffer.concat([header,query.subarray(12,at),record]),peer.port,peer.address);
    });
    await new Promise(resolve=>dns.bind(dnsPort,host,resolve));
  }
  return {app,observations,close:async()=>{dns?.close();await new Promise(resolve=>app.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await startAuthenticatedFixture({dnsPort:53});console.log('Controlled authenticated Recon fixture ready.');}
