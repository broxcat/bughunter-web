// Focused, offline browser acceptance. Every service/database is disposable.
import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const execute=promisify(execFile),prefix='bh-assessment-browser-'+randomUUID().slice(0,8),containers=[];
const docker=async(...args)=>(await execute('docker',args,{timeout:60000,maxBuffer:1024*1024})).stdout.trim();
try{
  for(const [suffix,args]of[
    ['pg',['--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=disposable-assessment','-e','POSTGRES_DB=assessment_browser_test','-p','127.0.0.1::5432','postgres:16-alpine']],
    ['redis',['--tmpfs','/data','-p','127.0.0.1::6379','redis:7-alpine']],
  ]){const name=prefix+'-'+suffix;containers.push(name);await docker('run','-d','--name',name,'--label','bughunter.assessment-test=disposable',...args);}
  for(let i=0;;i++){try{await docker('exec',prefix+'-pg','pg_isready','-U','postgres');break;}catch{if(i>100)throw new Error('Disposable PostgreSQL readiness timeout');await new Promise(r=>setTimeout(r,100));}}
  const pg=(await docker('port',prefix+'-pg','5432/tcp')).split(':').at(-1),redis=(await docker('port',prefix+'-redis','6379/tcp')).split(':').at(-1);
  const database=`postgresql://postgres:disposable-assessment@127.0.0.1:${pg}/assessment_browser_test`;
  const env={...process.env,LOG_LEVEL:'silent',DATABASE_URL:database,TEST_ASSESSMENT_DATABASE_URL:database,TEST_ASSESSMENT_REDIS_URL:'redis://127.0.0.1:'+redis,TEST_ASSESSMENT_REDIS_CONTAINER:prefix+'-redis'};
  await execute('npx',['prisma','migrate','deploy'],{env,timeout:60000,maxBuffer:1024*1024});
  const child=spawn(process.execPath,['tests/e2e/assessmentWorkflow.mjs'],{env,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw new Error('Assessment browser acceptance failed');
}catch(error){console.error(error instanceof Error?error.message:'Assessment browser acceptance failed');process.exitCode=1;}
finally{for(const name of containers.reverse())await docker('rm','-f',name).catch(()=>{process.exitCode=1;});}
