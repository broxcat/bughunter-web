// All state is disposable. No configured DB, Redis, console or target is reused.
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const execute=promisify(execFile),prefix='bh-coverage-browser-'+randomUUID().slice(0,8),containers=[];
const docker=async(...args)=>(await execute('docker',args,{timeout:60000,maxBuffer:1024*1024})).stdout.trim();
try{
  for(const [suffix,args]of[
    ['pg',['--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=disposable-research-plan','-e','POSTGRES_DB=research_plan_browser_test','-p','127.0.0.1::5432','postgres:16-alpine']],
    ['redis',['--tmpfs','/data','-p','127.0.0.1::6379','redis:7-alpine']],
  ]){const name=prefix+'-'+suffix;containers.push(name);await docker('run','-d','--name',name,'--label','bughunter.coverage-test=disposable',...args);}
  for(let attempt=0;;attempt++){try{await docker('exec',prefix+'-pg','pg_isready','-U','postgres');break;}catch{if(attempt>100)throw new Error('Disposable plan database readiness timeout');await new Promise(resolve=>setTimeout(resolve,100));}}
  const pg=(await docker('port',prefix+'-pg','5432/tcp')).split(':').at(-1),redis=(await docker('port',prefix+'-redis','6379/tcp')).split(':').at(-1),database=`postgresql://postgres:disposable-research-plan@127.0.0.1:${pg}/research_plan_browser_test`;
  const env={...process.env,LOG_LEVEL:'silent',DATABASE_URL:database,TEST_RESEARCH_PLAN_DATABASE_URL:database,TEST_RESEARCH_PLAN_REDIS_URL:'redis://127.0.0.1:'+redis,TEST_RESEARCH_PLAN_REDIS_CONTAINER:prefix+'-redis'};
  await execute('npx',['prisma','migrate','deploy'],{env,timeout:60000,maxBuffer:1024*1024});
  const child=spawn(process.execPath,['--import','tsx','tests/e2e/researchCoverageWorkflow.mjs'],{env,stdio:'inherit'});const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});if(code!==0)throw new Error('Research Coverage browser acceptance failed');
}catch(error){console.error(error instanceof Error?error.message:'Research Coverage browser acceptance failed');process.exitCode=1;}
finally{for(const name of containers.reverse())await docker('rm','-f',name).catch(()=>{process.exitCode=1;});}
