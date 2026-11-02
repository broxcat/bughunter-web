// Real current Compose stack only. No model inference, targets, volume deletion,
// DB resets or migrations. Burp remains the same container throughout rebuild.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const execute = promisify(execFile);
const compose = async (...args) => (await execute('docker', ['compose', ...args], { timeout: 300000, maxBuffer: 10 * 1024 * 1024 })).stdout.trim();
async function assertNoUserSessions() {
  let active = '';
  // Native diagnostic subprocesses may take a moment to exit after reporting.
  // Wait briefly for those; a persistent conversation still blocks every restart.
  for (let attempt = 0; attempt < 10; attempt++) {
    active = await compose('exec', '-T', 'research-console', 'python3', '-c', `import os
active=0
for pid in os.listdir('/proc'):
 if not pid.isdigit(): continue
 try:
  name=open('/proc/'+pid+'/comm').read().strip()
  if name in ['codex','claude','tmux: server']: active+=1
 except (OSError,PermissionError): pass
print(active)`);
    if (active === '0') return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(active, '0', 'Refusing MCP rebuild while native CLI/tmux sessions are active');
}
const cwd = process.env.RESEARCH_MCP_TEST_WORKSPACE ?? (await compose('exec', '-T', 'research-console', 'sh', '-c', 'find /workspaces -maxdepth 1 -type d -name "research_*" | sort | head -1'));
assert.match(cwd, /^\/workspaces\/research_[A-Za-z0-9_-]+$/);
const burpId = await compose('ps', '-q', 'burp'); assert(burpId);
const fingerprint = () => compose('exec', '-T', 'research-console', 'python3', '-c', `import os,hashlib,json
roots=['/home/researcher/.codex','/home/researcher/.claude']
result={}
for root in roots:
 for base,dirs,files in os.walk(root):
  dirs[:]=[d for d in dirs if d not in ['node_modules','tmp','logs']]
  for name in files:
   if name in ['auth.json','.credentials.json','settings.json','config.toml','bughunter-mcp.json'] or name.endswith('.jsonl'):
    p=os.path.join(base,name)
    result[p]=hashlib.sha256(open(p,'rb').read()).hexdigest()
print(json.dumps(result,sort_keys=True))`);
const before = JSON.parse(await fingerprint());
async function waitBurp() {
  for (let i = 0; i < 120; i++) {
    const state = (await execute('docker', ['inspect', '--format', '{{.State.Health.Status}}', burpId])).stdout.trim();
    if (state === 'healthy') return;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Burp readiness timeout');
}
async function waitResearch() {
  for (let i = 0; i < 30; i++) {
    try { await compose('exec', '-T', 'research-console', 'console-healthcheck'); return; }
    catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('Research readiness timeout');
}
let probe, output = '';
function start() {
  output = '';
  probe = spawn('docker', ['compose', 'exec', '-T', '-u', 'researcher', 'research-console', 'node', '/opt/bughunter/docker/research/validator/mcp-acceptance.mjs', cwd], { stdio: ['pipe', 'pipe', 'inherit'] });
  probe.stdout.on('data', data => { output += data; process.stdout.write(data); });
}
async function check(command) {
  output = ''; probe.stdin.write(command + '\n');
  const end = Date.now() + 60000;
  while (!output.includes('ACCEPTANCE_OK')) {
    if (output.includes('ACCEPTANCE_FAILED') || probe.exitCode !== null || Date.now() > end) throw new Error('Real MCP check failed: ' + output);
    await new Promise(r => setTimeout(r, 250));
  }
}
async function stop() { if (probe) { if (probe.exitCode === null) { probe.stdin.end('exit\n'); await new Promise(r => probe.once('exit', r)); } probe = undefined; } }
try {
  await assertNoUserSessions();
  await waitBurp(); await waitResearch();
  start(); await check('online'); await stop();
  await compose('build', 'research-console');
  await assertNoUserSessions();
  await compose('up', '-d', '--no-deps', '--force-recreate', 'research-console');
  await waitResearch();
  assert.equal(await compose('ps', '-q', 'burp'), burpId, 'Burp must remain independent');
  start(); await check('online');
  await assertNoUserSessions();
  await compose('stop', 'burp'); await check('offline');
  await compose('start', 'burp');
  await waitBurp();
  await check('online'); await stop();
  await assertNoUserSessions();
  await compose('restart', 'research-console');
  await waitResearch();
  start(); await check('online'); await stop();
  const after = JSON.parse(await fingerprint());
  for (const [path, hash] of Object.entries(before)) assert.equal(after[path], hash, 'Existing session/config/auth changed: ' + path);
  console.log('REAL MCP REBUILD PASSED: native Codex + Claude, same Burp, live client outage/recovery, Research restart, existing auth/config/transcripts unchanged.');
} finally { await stop(); await compose('start', 'burp'); }
