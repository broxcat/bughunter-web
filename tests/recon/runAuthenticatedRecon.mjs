// Offline acceptance with disposable DB/queue/application only. No production
// service, credential store, console session or external target is used.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {mkdtemp,chmod,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const execute=promisify(execFile),prefix='bh-auth-recon-'+randomUUID().slice(0,8),containers=[];
const image=process.env.AUTHENTICATED_RECON_TEST_IMAGE??process.env.RESEARCH_TEST_APP_IMAGE??'bughunter-web:assessment-foundation-validated';
const browserOnly=process.argv.includes('--browser-only'),nativeOnly=process.argv.includes('--native-only'),mappingOnly=process.argv.includes('--mapping-only');
if([browserOnly,nativeOnly,mappingOnly].filter(Boolean).length>1)throw new Error('Choose one acceptance mode');
const directory=await mkdtemp(join(tmpdir(),'bh-auth-recon-'));await chmod(directory,0o700);
const docker=async(...args)=>(await execute('docker',args,{timeout:900000,maxBuffer:1024*1024})).stdout.trim();
let ownsNetwork=false;
try{
  await docker('network','create','--internal','--label','bughunter.auth-recon-test=disposable',prefix);ownsNetwork=true;
  for(const [suffix,args]of[
    ['db',['--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=disposable-auth-recon','-e','POSTGRES_DB=authenticated_recon_test','postgres:16-alpine']],
    ['redis',['--tmpfs','/data','redis:7-alpine']],
    ['fixture',['--network-alias','auth.fixture.test','--network-alias','foreign.fixture.test','--network-alias','sibling.fixture.test','--mount',`type=bind,source=${resolve('tests/recon/authenticatedFixture.mjs')},target=/fixture.mjs,readonly`,'node:22-bookworm','node','/fixture.mjs']],
  ]){const name=prefix+'-'+suffix;containers.push(name);await docker('run','-d','--name',name,'--network',prefix,'--network-alias',suffix,'--label','bughunter.auth-recon-test=disposable',...args);}
  for(let attempt=0;;attempt++){try{await docker('exec',prefix+'-db','pg_isready','-U','postgres');break;}catch{if(attempt>100)throw new Error('Disposable database readiness timeout');await new Promise(r=>setTimeout(r,100));}}
  const fixtureIp=await docker('inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',prefix+'-fixture');
  const env=['-e','BH_DISPOSABLE_AUTH_RECON=1','-e','DATABASE_URL=postgresql://postgres:disposable-auth-recon@db:5432/authenticated_recon_test','-e','REDIS_URL=redis://redis:6379','-e','LOG_LEVEL=silent','-e','CREDENTIALS_ENCRYPTION_KEY='+'ab'.repeat(32),'-e','AUTH_SECRET=disposable-auth-recon-fixture','-e','AUTH_URL=http://127.0.0.1:3000','-e','RESEARCH_CONSOLE_ROOT=/tmp/research-auth-recon-fixture','-e','AUTH_RECON_NATIVE='+String(!browserOnly),'-e','AUTH_RECON_BROWSER='+String(!nativeOnly)];
  if(process.getuid&&process.getgid)env.push('-e','AUTH_RECON_OUTPUT_UID='+process.getuid(),'-e','AUTH_RECON_OUTPUT_GID='+process.getgid());
  const mounts=[['src','/app/src'],['prisma','/app/prisma'],['tsconfig.json','/app/tsconfig.json'],['node_modules/.prisma','/app/node_modules/.prisma'],['tests/recon/authenticatedFixture.mjs','/app/tests/recon/authenticatedFixture.mjs'],['tests/recon/authenticatedRecon.mts','/app/tests/recon/authenticatedRecon.mts'],['tests/recon/authenticatedMappingMatrix.mts','/app/tests/recon/authenticatedMappingMatrix.mts']].flatMap(([source,destination])=>['--mount',`type=bind,source=${resolve(source)},target=${destination},readonly`]);
  mounts.push('--mount',`type=bind,source=${directory},target=/acceptance`);
  await docker('run','--rm','--network',prefix,'--dns',fixtureIp,...env,...mounts,image,'npx','prisma','migrate','deploy');
  const output=await docker('run','--rm','--network',prefix,'--dns',fixtureIp,...env,...mounts,image,'node','--import','tsx',mappingOnly?'tests/recon/authenticatedMappingMatrix.mts':'tests/recon/authenticatedRecon.mts');
  for(const line of output.split('\n'))if(line.startsWith('{')){const value=JSON.parse(line);if(value.acceptance==='authenticated-recon')console.log(JSON.stringify(value));}
  if(!nativeOnly&&!mappingOnly){const destination='/tmp/bughunter-authenticated-recon-ui.png';await copyFile(join(directory,'authentication.png'),destination);await chmod(destination,0o600);}
}catch(error){
  // A failing assertion can contain private response material. Keep the error
  // private for local diagnosis; emit only fixed harness status to the terminal.
  const {writeFile}=await import('node:fs/promises');await writeFile('/tmp/bughunter-authenticated-recon-failure.log',String(error?.stdout??'')+'\n'+String(error?.stderr??'')+'\n'+String(error?.stack??error),{mode:0o600});
  try{await copyFile(join(directory,'native-failure.json'),'/tmp/bughunter-authenticated-recon-native-failure.json');await chmod('/tmp/bughunter-authenticated-recon-native-failure.json',0o600);}catch{/* No native diagnostic is claimed after setup failure. */}
  try{await copyFile(join(directory,'native-surface.json'),'/tmp/bughunter-authenticated-recon-native-surface.json');await chmod('/tmp/bughunter-authenticated-recon-native-surface.json',0o600);}catch{/* No surface is claimed before mapping completed. */}
  console.error('AUTHENTICATED_RECON_ACCEPTANCE_FAIL: private diagnostic /tmp/bughunter-authenticated-recon-failure.log');process.exitCode=1;
}finally{for(const name of containers.reverse())await docker('rm','-f',name).catch(()=>{process.exitCode=1;});if(ownsNetwork)await docker('network','rm',prefix).catch(()=>{process.exitCode=1;});await rm(directory,{recursive:true,force:true});}
