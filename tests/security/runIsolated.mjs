// Never reads .env, never reuses a service or joins an existing Docker network.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const exec = promisify(execFile);
const prefix = `bh-audit-${randomUUID().slice(0, 8)}`;
const names = { pg: `${prefix}-pg`, redis: `${prefix}-redis`, browser: `${prefix}-browser`, runner: `${prefix}-runner` };
const network = `${prefix}-net`, volume = `${prefix}-socket`;
const created = [];
const docker = async (...args) => (await exec('docker', args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
async function run(name, args) { created.push(name); await docker('run', '-d', '--name', name, '--label', 'bughunter.audit=disposable', ...args); }
async function ready(name, args) {
  for (let i = 0; i < 100; i++) { try { await docker('exec', name, ...args); return; } catch { await new Promise(r => setTimeout(r, 200)); } }
  throw new Error(`Fixture unavailable: ${name}`);
}
async function checked(args) {
  const child = spawn('docker', args, { stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) throw new Error(`Isolated command failed (${code})`);
}
try {
  await docker('version'); // do not start Docker Desktop
  await docker('network', 'create', '--internal', '--label', 'bughunter.audit=disposable', network);
  await docker('volume', 'create', '--label', 'bughunter.audit=disposable', volume);
  await run(names.pg, ['--network', network, '--network-alias', 'audit-pg', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD=disposable-only', 'postgres:16-alpine']);
  await run(names.redis, ['--network', network, '--network-alias', 'audit-redis', 'redis:7-alpine', 'redis-server', '--requirepass', 'disposable-only', '--appendonly', 'yes', '--appendfsync', 'always', '--maxmemory-policy', 'noeviction']);
  await ready(names.pg, ['pg_isready', '-U', 'postgres']);
  await ready(names.redis, ['redis-cli', '-a', 'disposable-only', 'ping']);
  // Confirm durable capacity survives a real stop/start, before any renderer.
  await docker('exec', names.redis, 'redis-cli', '-a', 'disposable-only', 'HSET', 'capacity:pdf:v2', 'capacity', '1', 'fixture-owner', '{"expiresAt":0}');
  await docker('stop', '-t', '0', names.redis);
  await docker('start', names.redis);
  await ready(names.redis, ['redis-cli', '-a', 'disposable-only', 'ping']);
  const retained = await docker('exec', names.redis, 'redis-cli', '-a', 'disposable-only', 'HGET', 'capacity:pdf:v2', 'fixture-owner');
  if (retained !== '{"expiresAt":0}') throw new Error('Redis lost capacity on restart');
  await docker('exec', names.redis, 'redis-cli', '-a', 'disposable-only', 'DEL', 'capacity:pdf:v2');
  console.log('PASS Redis durable capacity survives forced restart');
  for (const db of ['fixtures', 'upgrade']) await docker('exec', names.pg, 'createdb', '-U', 'postgres', db);
  const denied = await docker('exec', names.redis, 'redis-cli', 'ping');
  if (!denied.includes('NOAUTH')) throw new Error('Unauthenticated Redis unexpectedly accepted');
  console.log('PASS Redis rejects missing credentials');
  // A web/worker container may initialize the socket volume first. Both images
  // must give this directory the same non-root owner, independent of start order.
  await checked(['run', '--rm', '--network', 'none', '--user', '10001:10001', '--mount', `type=volume,source=${volume},target=/run/browser`, 'bughunter-audit-app:remediation', 'node', '-e', "const fs=require('fs');fs.writeFileSync('/run/browser/fixture-probe','x');fs.unlinkSync('/run/browser/fixture-probe');console.log('PASS socket volume initialized by non-root application image');"]);
  await run(names.browser, ['--network', 'none', '--init', '--user', '10001:10001', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--security-opt', `seccomp=${resolve('docker/browser/seccomp.json')}`, '--pids-limit', '1024', '--memory', '2g', '--shm-size', '1g', '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,uid=10001,gid=10001', '--mount', `type=volume,source=${volume},target=/run/browser`, 'bughunter-audit-browser:remediation']);
  const db = 'postgresql://postgres:disposable-only@audit-pg:5432/fixtures';
  const env = { DATABASE_URL: db, TEST_DATABASE_URL: db, TEST_AUDIT_UPGRADE_URL: db.replace('/fixtures', '/upgrade'), REDIS_URL: 'redis://:disposable-only@audit-redis:6379', TEST_REDIS_URL: 'redis://:disposable-only@audit-redis:6379', TEST_AUDIT: '1', SCANNER_HTTP_TESTS: '1', BROWSER_SOCKET_PATH: '/run/browser/broker.sock', AUTH_SECRET: 'disposable-audit-secret-only', AUTH_URL: 'http://127.0.0.1:3999', CREDENTIALS_ENCRYPTION_KEY: 'ab'.repeat(32), LOG_LEVEL: 'silent' };
  await run(names.runner, ['--network', network, '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--tmpfs', '/app/node_modules/.vitest-cache:rw,uid=10001,gid=10001', '--mount', `type=volume,source=${volume},target=/run/browser`, ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), 'bughunter-audit-app:remediation', 'node', '-e', 'setInterval(()=>{},1000)']);
  // Copy only the current test/source changes, never .env or operator data.
  for (const path of ['src', 'tests', 'prisma']) await docker('cp', path, `${names.runner}:/app/`);
  for (const path of ['Dockerfile', 'docker-compose.yml']) await docker('cp', path, `${names.runner}:/app/${path}`);
  await ready(names.runner, ['node', '-e', "require('fs').accessSync('/run/browser/broker.sock')"]);
  await checked(['exec', names.runner, 'node', '-e', "const fs=require('fs'),assert=require('assert/strict'),{chromium}=require('playwright-chromium');assert.equal(fs.existsSync('/ms-playwright'),false);assert.equal(fs.existsSync(chromium.executablePath()),false);console.log('PASS web/worker image contains no Chromium executable');"]);
  const addresses = await Promise.all([names.pg, names.redis, names.runner].map(name => docker('inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', name)));
  const mode = await docker('inspect', '-f', '{{.HostConfig.NetworkMode}}', names.browser);
  if (mode !== 'none') throw new Error('Browser has a network');
  // No public IP or real metadata endpoint is probed. These are exclusively
  // the IPs of the disposable DB/Redis/runner on our isolated internal network.
  await checked(['exec', names.browser, 'node', '--input-type=module', '-e', `import net from 'node:net';import assert from 'node:assert/strict';import fs from 'node:fs';assert.equal(process.getuid(),10001);for(const key of ['DATABASE_URL','REDIS_URL','CREDENTIALS_ENCRYPTION_KEY','AUTH_SECRET'])assert.equal(process.env[key],undefined);assert.equal(fs.existsSync('/app'),false);assert.equal(fs.existsSync('/var/run/docker.sock'),false);for(const [host,port] of ${JSON.stringify(addresses.map((ip, i) => [ip, [5432, 6379, 3999][i]]))})await new Promise((resolve,reject)=>{const s=net.connect({host,port});s.setTimeout(1000);s.on('connect',()=>{s.destroy();reject(new Error('Browser reached control network'))});s.on('error',()=>resolve());s.on('timeout',()=>{s.destroy();resolve()})});console.log('PASS uid, no secrets, no app/docker mount, network namespace blocks control services');`]);
  await checked(['exec', names.runner, 'npx', 'prisma', 'migrate', 'deploy']);
  await checked(['exec', names.runner, 'npm', 'run', 'recon:doctor', '--', '--strict', '--output', '/tmp/audit-doctor.json']);
  // Exercise the gate while its actual disposable backend is stopped, rather
  // than accepting a connection failure to an unrelated endpoint as proof.
  try {
    await docker('stop', '-t', '0', names.redis);
    const admission = JSON.parse(await docker('exec', names.runner, 'node', '--import', 'tsx', 'tests/security/pdfLeaseChild.mts'));
    if (admission.admitted || admission.reason !== 'UNAVAILABLE') throw new Error('PDF admitted during Redis outage');
    console.log('PASS PDF gate fails closed during actual Redis outage');
  } finally { await docker('start', names.redis); await ready(names.redis, ['redis-cli', '-a', 'disposable-only', 'ping']); }
  if (process.argv.includes('--baseline')) {
    await docker('cp', 'artifacts/security-audit/baseline.tar', `${names.runner}:/tmp/audit-baseline.tar`);
    await docker('exec', names.runner, 'node', '-e', "const fs=require('fs'),cp=require('child_process');fs.mkdirSync('/tmp/audit-baseline');cp.execFileSync('tar',['-xf','/tmp/audit-baseline.tar','-C','/tmp/audit-baseline']);fs.symlinkSync('/app/node_modules','/tmp/audit-baseline/node_modules');");
    console.log('BASELINE 1fe73e9: begin unchanged SQL suites');
    try { await checked(['exec', '--workdir', '/tmp/audit-baseline', names.runner, 'npx', 'vitest', 'run', '--configLoader=runner', '--maxWorkers=1', 'tests/integration/apiRoutes.test.ts', 'tests/integration/programPagination.test.ts']); }
    catch { console.log('BASELINE returned nonzero; see exact failures above (not counted as acceptance)'); }
    console.log('BASELINE 1fe73e9: end');
  }
  const focused = process.argv.includes('--focused') ? ['tests/security/liveAcceptance.test.ts', 'tests/network', 'tests/unit/handlerBoundaries.test.ts', 'tests/unit/pdfExportGate.test.ts', 'tests/unit/pdfCache.test.ts', 'tests/unit/pdfRenderDeadline.test.ts', 'tests/unit/scanAbort.test.ts', 'tests/unit/egressGuard.test.ts', 'tests/unit/deploymentHardening.test.ts', 'tests/unit/browserPolicy.test.ts', 'tests/unit/scopeAdmission.test.ts'] : [];
  await checked(['exec', names.runner, 'npx', 'vitest', 'run', '--configLoader=runner', '--maxWorkers=2', '--testTimeout=30000', '--hookTimeout=120000', ...focused]);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  for (const name of created.reverse()) {
    try { await docker('rm', '-f', '-v', name); } catch { console.error(`Cleanup failed: ${name}`); process.exitCode = 1; }
  }
  try { await docker('volume', 'rm', volume); await docker('network', 'rm', network); console.log('PASS disposable infrastructure removed'); } catch { process.exitCode = 1; }
}
