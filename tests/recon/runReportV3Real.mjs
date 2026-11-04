// Explicit, optional acceptance against the Settings-selected Ollama server.
// Application databases/volumes are never mounted or reused. The caller must
// supply a private read-only export; evidence/model bodies are never logged.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const execute = promisify(execFile);
const source = resolve(process.env.RECON_REPORT_V3_SOURCE_FILE ?? '/tmp/bughunter-report3-source.json');
const image = process.env.RECON_REPORT_V3_IMAGE ?? process.env.RESEARCH_TEST_APP_IMAGE ?? 'bughunter-web:methodology-final';
// Some deployments deliberately expose Ollama only to the application's egress
// namespace. Reusing that namespace is read-only: no existing container, port,
// filesystem, database or session is stopped/modified. Unique fixture DNS names
// prevent accidental selection of an existing `db` or `redis` service.
const namespace = process.env.RECON_REPORT_V3_NETWORK_CONTAINER;
if (namespace) assert(/^[A-Za-z0-9_.-]+$/.test(namespace), 'Invalid application network namespace');
const routerOnly=process.argv.includes('--openrouter-only');
const factsRender=process.argv.includes('--facts-render');
const routing = process.argv.includes('--routing')||routerOnly||factsRender;
const configsFile = resolve(process.env.RECON_ROUTING_CONFIGS_FILE ?? '/tmp/bughunter-ai-routing-configs.json');
const browserOnly = process.argv.includes('--browser-only'), modelOnly = process.argv.includes('--model-only');
assert(!(browserOnly && modelOnly), 'Choose one acceptance mode');
const sourceStat = await stat(source);
assert(sourceStat.isFile() && (sourceStat.mode & 0o077) === 0, 'Recon export must be a private regular file');
const beforeHash = createHash('sha256').update(await readFile(source)).digest('hex');
const directory = await mkdtemp(join(tmpdir(), 'bh-report-v3-real-'));
await chmod(directory, 0o700);
const reports = process.env.RECON_REPORT_V3_REPORTS_FILE ? resolve(process.env.RECON_REPORT_V3_REPORTS_FILE) : join(directory, 'reports.json');
assert.notEqual(reports, source, 'Saved report output cannot overwrite the source export');
if (browserOnly) {
  assert(process.env.RECON_REPORT_V3_REPORTS_FILE, 'Browser-only acceptance needs the private saved report file');
  assert(((await stat(reports)).mode & 0o077) === 0, 'Saved reports must be private');
}
const prefix = 'bh-report-v3-' + randomUUID().slice(0, 8), containers = [];
let ownsNetwork = false;
let dockerEnv = process.env;
const docker = async (...args) => (await execute('docker', args, { timeout: 1200000, maxBuffer: 1024 * 1024, env: dockerEnv })).stdout.trim();
const emitMetadata = output => {
  for (const line of String(output ?? '').split('\n')) {
    if (!line.startsWith('{')) continue;
    try { const item = JSON.parse(line); if (item.acceptance === 'recon-report-v3') console.log(JSON.stringify(item)); }
    catch { /* Never forward unstructured diagnostic or remote content. */ }
  }
};
const copyPrivateScreenshots=async()=>{
  if(!factsRender||!process.env.RECON_REPORT_V3_REPORTS_FILE)return;
  for(const suffix of ['scope-facts','scope-ai','target-facts','target-ai'])try{await copyFile(join(directory,'reports.json.'+suffix+'.png'),reports+'.'+suffix+'.png');await chmod(reports+'.'+suffix+'.png',0o600);}catch{/* Missing screenshots are not fabricated. */}
};
try {
  await copyFile(source, join(directory, 'source.json')); await chmod(join(directory, 'source.json'), 0o600);
  if (routing) {
    assert(namespace, 'Routing acceptance needs the explicitly authorized application namespace');
    assert(((await stat(configsFile)).mode & 0o077) === 0, 'Encrypted configuration fixture must be private');
    await copyFile(configsFile, join(directory, 'configs.json')); await chmod(join(directory, 'configs.json'), 0o600);
    // Ciphertext stays encrypted on disk. The master exists only in backend
    // process memory/environment and is inherited by Docker with `-e NAME`.
    const master = await docker('exec', namespace, 'node', '-e', 'process.stdout.write(process.env.CREDENTIALS_ENCRYPTION_KEY??"")');
    assert(/^[a-f0-9]{64}$/i.test(master), 'Backend encryption environment unavailable');
    dockerEnv = { ...process.env, CREDENTIALS_ENCRYPTION_KEY: master };
    if(routerOnly){const baseline=resolve(process.env.RECON_ROUTING_BASELINE_FILE??'/tmp/bughunter-report-v3-generated.json');assert(((await stat(baseline)).mode&0o077)===0,'Real Ollama baseline must be private');await copyFile(baseline,join(directory,'baseline.json'));await chmod(join(directory,'baseline.json'),0o600);}
  }
  if (browserOnly) { await copyFile(reports, join(directory, 'replay.json')); await chmod(join(directory, 'replay.json'), 0o600); }
  const network = namespace ? Object.keys(JSON.parse(await docker('inspect', '--format', '{{json .NetworkSettings.Networks}}', namespace)))[0] : prefix;
  assert(network, 'Application network namespace has no attached network');
  if (!namespace) { await docker('network', 'create', '--label', 'bughunter.report-v3=disposable', prefix); ownsNetwork = true; }
  for (const [name, args] of [
    ['db', ['--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD=disposable-report', '-e', 'POSTGRES_DB=report_v3_real_test', 'postgres:16-alpine']],
    ['redis', ['redis:7-alpine']],
  ]) {
    const id = prefix + '-' + name; containers.push(id);
    await docker('run', '-d', '--name', id, '--network', network, '--network-alias', id, '--label', 'bughunter.report-v3=disposable', ...args);
  }
  for (let n = 0;; n++) {
    try { await docker('exec', prefix + '-db', 'pg_isready', '-U', 'postgres'); break; }
    catch { assert(n < 100, 'Disposable database readiness timeout'); await new Promise(r => setTimeout(r, 100)); }
  }
  const env = ['-e', 'BH_DISPOSABLE_REPORT_V3=1', '-e', `DATABASE_URL=postgresql://postgres:disposable-report@${prefix}-db:5432/report_v3_real_test`, '-e', `REDIS_URL=redis://${prefix}-redis:6379`, '-e', 'AUTH_URL=http://127.0.0.1:3000', '-e', 'AUTH_SECRET=disposable-report-acceptance', '-e', routing ? 'CREDENTIALS_ENCRYPTION_KEY' : 'CREDENTIALS_ENCRYPTION_KEY=' + 'ab'.repeat(32), '-e', 'LOG_LEVEL=silent', '-e', 'RECON_REPORT_V3_SOURCE_FILE=/acceptance/source.json', '-e', 'RECON_REPORT_V3_OUTPUT_FILE=/acceptance/reports.json', '-e', 'RECON_REPORT_V3_BROWSER=' + String(!modelOnly), ...(routing ? ['-e', 'RECON_REPORT_MULTI_PROVIDER=1', '-e', 'RECON_ROUTING_CONFIGS_FILE=/acceptance/configs.json'] : []), ...(browserOnly ? ['-e', 'RECON_REPORT_V3_REPLAY_FILE=/acceptance/replay.json'] : [])];
  if (process.getuid && process.getgid) env.push('-e', 'RECON_REPORT_V3_OUTPUT_UID=' + process.getuid(), '-e', 'RECON_REPORT_V3_OUTPUT_GID=' + process.getgid());
  if(routerOnly)env.push('-e','RECON_ROUTING_ROUTER_ONLY=1','-e','RECON_ROUTING_BASELINE_FILE=/acceptance/baseline.json');
  if(process.argv.includes('--allow-factual-only'))env.push('-e','RECON_ROUTING_ALLOW_FACTUAL_ONLY=1');
  if(factsRender)env.push('-e','RECON_FACTS_RENDER_ACCEPTANCE=1','-e','RECON_ROUTING_ALLOW_FACTUAL_ONLY=1');
  const mounts = [['src', '/app/src'], ['prisma', '/app/prisma'], ['tsconfig.json', '/app/tsconfig.json'], ['tests/recon/reportV3Real.mts', '/app/tests/recon/reportV3Real.mts'], ['node_modules/.prisma', '/app/node_modules/.prisma']].flatMap(([path, destination]) => ['--mount', `type=bind,source=${resolve(path)},target=${destination},readonly`]);
  mounts.push('--mount', `type=bind,source=${directory},target=/acceptance`);
  const executionNetwork = namespace ? 'container:' + namespace : network;
  await docker('run', '--rm', '--network', executionNetwork, ...env, ...mounts, image, 'npx', 'prisma', 'migrate', 'deploy');
  const result = await docker('run', '--rm', '--network', executionNetwork, ...env, ...mounts, image, 'node', '--import', 'tsx', 'tests/recon/reportV3Real.mts');
  // Only this helper's bounded, explicit acceptance metadata can reach logs.
  emitMetadata(result);
  await copyPrivateScreenshots();
  assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), beforeHash, 'Original export changed');
  if (!browserOnly && process.env.RECON_REPORT_V3_REPORTS_FILE) {
    await mkdir(dirname(reports), { recursive: true, mode: 0o700 });
    await copyFile(join(directory, 'reports.json'), reports); await chmod(reports, 0o600);
  }
  console.log(JSON.stringify({ acceptance: 'recon-report-v3', phase: 'isolation', status: 'PASS', originalExportUnchanged: true, sourceSha256: beforeHash, mode: browserOnly ? 'browser-only' : modelOnly ? 'model-only' : 'model-and-browser' }));
} catch (error) {
  // CLI errors may contain private model output or evidence. Keep diagnostics
  // in the helper's controlled metadata rather than printing exception bodies.
  emitMetadata(error?.stdout);
  await copyPrivateScreenshots();
  if (process.env.RECON_REPORT_V3_REPORTS_FILE) {
    try { await copyFile(join(directory, 'reports.json.failed.json'), reports + '.failed.json'); await chmod(reports + '.failed.json', 0o600); }
    catch { /* A preflight failure need not have a persisted report. */ }
  }
  console.error(JSON.stringify({ acceptance: 'recon-report-v3', phase: 'harness', status: 'FAIL', ...(typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.code) ? { code: error.code } : {}) }));
  process.exitCode = 1;
} finally {
  for (const id of containers.reverse()) await docker('rm', '-f', id).catch(() => { process.exitCode = 1; });
  if (ownsNetwork) await docker('network', 'rm', prefix).catch(() => { process.exitCode = 1; });
  await rm(directory, { recursive: true, force: true });
  dockerEnv = process.env;
}
