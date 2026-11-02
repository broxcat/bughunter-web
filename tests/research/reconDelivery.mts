// Real tmux + installed CLI interface smoke test in a networkless, disposable runner.
// Captures composer input; does not run a model or claim an agent read the evidence.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { researchTarget } from '../fixtures/research';
import { consoleBundle, writeConsoleWorkspace } from '@/server/research/consoleWorkspace';
import { buildReconContext, compactReconContext, reconHash, reconJson } from '@/server/research/reconContext';
import { publishReconFiles } from '@/server/research/reconFiles';
const execute = promisify(execFile), temporary = await mkdtemp(join(tmpdir(), 'recon-native-'));
try {
  const target = researchTarget(); target.id = `recon_fixture_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = `research_${target.id}`, workspaceRoot = join(temporary, 'workspaces');
  const bundle = consoleBundle(target, null, [], { id: 'fixture_session', workspaceId, createdAt: new Date() });
  await writeConsoleWorkspace(workspaceRoot, target.id, bundle);
  const context = buildReconContext({ programId: 'program', scopeId: 'scope', targetId: target.id, generatedAt: new Date().toISOString(), runs: [], inScope: () => false, activeSuggestionsAllowed: false });
  const contextText = reconJson(context), summaryText = reconJson(compactReconContext(context)), contentSha256 = reconHash(contextText), summarySha256 = reconHash(summaryText);
  await publishReconFiles(workspaceRoot, workspaceId, { contentSha256, contextText, summaryText });
  const keys = generateKeyPairSync('ed25519');
  await writeFile(join(temporary, 'manifest.json'), JSON.stringify({ targetId: target.id, workspaceId, contentSha256, summarySha256, policySha256: reconHash(bundle['.agents/bughunter/policy.json']), privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }) }), { mode: 0o644 });
  await writeFile(join(temporary, 'capture.py'), `import os,sys,termios,tty,select,time
tty.setraw(0)
os.write(1,b'\\x1b[?2004h')
open(sys.argv[1]+'.ready','w').write('ready')
data=b''
end=time.time()+15
while time.time()<end:
 if select.select([0],[],[],0.2)[0]: data+=os.read(0,8192)
 elif data: break
open(sys.argv[1],'wb').write(data)
`);
  await writeFile(join(temporary, 'check.mjs'), `import assert from 'node:assert/strict';
import {execFile} from 'node:child_process'; import {promisify} from 'node:util';
import {readFile,access} from 'node:fs/promises';
import {stageReconContext} from '/opt/bughunter/docker/research/console/recon-context.mjs';
import {issueReconDelivery,reconDeliveryPrompt} from '/opt/bughunter/src/lib/research/reconDelivery.ts';
import {providerTmuxIdentity} from '/opt/bughunter/src/lib/research/provider.ts';
const m=JSON.parse(await readFile('/fixture/manifest.json','utf8')), exec=promisify(execFile);
const execute=(file,args,opts)=>exec(file,['-L','recon-fixture',...args],opts);
const cwd='/workspaces/'+m.workspaceId;
for(const provider of ['codex','claude']) {
 const version=(await exec(provider,['--version'],{timeout:10000})).stdout.trim();
 assert(version.length>0); await exec(provider,['--help'],{timeout:10000});
 const name=providerTmuxIdentity(m.targetId,provider), output=cwd+'/requests/'+provider+'.bin';
 await execute('tmux',['new-session','-d','-s',name,'-c',cwd,'python3 /fixture/capture.py '+output],{timeout:3000});
 for(let i=0;;i++){try{await access(output+'.ready');break;}catch{if(i>50)throw new Error('Capture readiness');await new Promise(r=>setTimeout(r,50));}}
 const ticket=issueReconDelivery({targetId:m.targetId,sessionId:'fixture_session',deliveryId:'fixture_'+provider,provider,contentSha256:m.contentSha256,summarySha256:m.summarySha256,policySha256:m.policySha256},m.privateKey);
 assert.equal((await stageReconContext(ticket,m.publicKey,execute)).status,'STAGED');
 let bytes; for(let i=0;;i++){try{bytes=await readFile(output,'utf8');break;}catch{if(i>50)throw new Error('Capture timeout');await new Promise(r=>setTimeout(r,50));}}
 assert.equal(bytes,'\\x1b[200~'+reconDeliveryPrompt(m.contentSha256)+'\\x1b[201~');
 assert(!bytes.includes('\\r')&&!bytes.includes('\\n'));
 console.log(provider+': native CLI --version/--help and real tmux bracketed paste passed; no model inference.');
}
console.log('RECON_NATIVE_TRANSPORT_PASSED');
`);
  // The base image supplies installed native CLIs and tmux. Mount current helpers
  // individually, so the smoke test can run before a production image rebuild.
  const args = ['run', '--rm', '--network', 'none', '--entrypoint', '/bin/sh',
    '--mount', `type=bind,source=${temporary},target=/fixture,readonly`,
    '--mount', `type=bind,source=${resolve('docker/research/console/recon-context.mjs')},target=/opt/bughunter/docker/research/console/recon-context.mjs,readonly`,
    '--mount', `type=bind,source=${resolve('src/lib/research/reconDelivery.ts')},target=/opt/bughunter/src/lib/research/reconDelivery.ts,readonly`,
    process.env.RESEARCH_TEST_RUNNER_IMAGE ?? 'bughunter-research', '-c',
    'cp -a /fixture/workspaces/. /workspaces/ && chown -R root:research /workspaces && chmod 3770 /workspaces && find /workspaces -type d -name requests -exec chown researcher:research {} + && runuser -u researcher -- node /fixture/check.mjs'];
  const result = await execute('docker', args, { timeout: 60000, maxBuffer: 32768 }); process.stdout.write(result.stdout);
} finally { await rm(temporary, { recursive: true, force: true }); }
