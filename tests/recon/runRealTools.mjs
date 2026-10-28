import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
const exec=promisify(execFile),prefix='bh-real-recon-'+randomUUID().slice(0,8),containers=[];
const image=process.env.RESEARCH_TEST_APP_IMAGE??'bughunter-web';
const docker=async(...args)=>(await exec('docker',args,{timeout:240000,maxBuffer:2**20})).stdout.trim();
try{
  await docker('network','create','--label','bughunter.real-recon=disposable',prefix);
  for(const [name,args] of [
    ['db',['--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=disposable','-e','POSTGRES_DB=recon_test','postgres:16-alpine']],
    ['redis',['redis:7-alpine']],
    ['fixture.recon.test',['node:22-bookworm','node','-e',`const observations=[];require('http').createServer((req,res)=>{if(req.url==='/__observations'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(observations));return;}observations.push({url:req.url,ua:req.headers['user-agent']});res.setHeader('Content-Type','text/html');res.end('<html><a href="/page">Local page</a></html>');}).listen(80,'0.0.0.0');`]],
  ]){const id=prefix+'-'+name;await docker('run','-d','--name',id,'--network',prefix,'--network-alias',name,'--label','bughunter.real-recon=disposable',...args);containers.push(id);}
  for(let i=0;i<80;i++){try{await docker('exec',prefix+'-db','pg_isready','-U','postgres');break;}catch{if(i===79)throw new Error('Test database unavailable');await new Promise(resolve=>setTimeout(resolve,100));}}
  const env=['-e','BH_DISPOSABLE_REAL_TOOLS=1','-e','DATABASE_URL=postgresql://postgres:disposable@db:5432/recon_test','-e','REDIS_URL=redis://redis:6379','-e','LOG_LEVEL=silent'];
  const migrate=prefix+'-migrate';containers.push(migrate);console.log(await docker('run','--rm','--name',migrate,'--network',prefix,...env,image,'npx','prisma','migrate','deploy'));
  const run=prefix+'-run';containers.push(run);console.log(await docker('run','--rm','--name',run,'--network',prefix,'-v',`${resolve('tests/recon/realTools.mts')}:/app/tests/recon/realTools.mts:ro`,...env,image,'node','--import','tsx','tests/recon/realTools.mts'));
}finally{for(const id of containers.reverse())await docker('rm','-f',id).catch(()=>{});await docker('network','rm',prefix).catch(()=>{});}
