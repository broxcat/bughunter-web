import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const execute = promisify(execFile), prefix = 'bh-asset-tools-' + randomUUID().slice(0, 8), containers = [];
const docker = async (...args) => (await execute('docker', args, { timeout: 420000, maxBuffer: 1024 * 1024 })).stdout.trim();
try {
  await docker('network', 'create', '--internal', '--label', 'bughunter.asset-test=disposable', prefix);
  for (const [name, args] of [
    ['db', ['--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD=disposable', '-e', 'POSTGRES_DB=asset_test', 'postgres:16-alpine']],
    ['redis', ['redis:7-alpine']],
    ['fixture.recon.test', ['node:22-bookworm', 'node', '-e', `const observations=[];require('http').createServer((req,res)=>{if(req.url.startsWith('/__observations')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(observations));return;}observations.push({url:req.url,ua:req.headers['user-agent']});res.setHeader('Server','nginx');res.setHeader('Set-Cookie','sid=PRIVATE_COOKIE');if(req.url.includes('openapi.json')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({openapi:'3.0.0',paths:{'/api/courses':{get:{}},'/api/auth/reset-password':{get:{}}}}));}if(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9-]{20,}/i.test(req.url)){res.statusCode=404;res.end('Not found');return;}if(req.url==='/api/'||req.url.includes('/private')){res.statusCode=401;res.setHeader('WWW-Authenticate','Bearer realm="fixture"');}res.setHeader('Content-Type','text/html');res.end('<html><title>Local API portal</title>PRIVATE_BODY<a href="/api/login">login</a><a href="/api/register">register</a><a href="/api/auth/register">auth</a><a href="/api/auth/reset-password">reset</a><a href="/api/courses?q=private">courses</a><a href="/api/private">private</a><a href="http://outside.test/outside">outside host</a><a href="/api/delete">unsafe read</a><script src="/api/client.js"></script></html>');}).listen(80,'0.0.0.0');`]],
  ]) { const id = prefix + '-' + name; await docker('run', '-d', '--name', id, '--network', prefix, '--network-alias', name, ...args); containers.push(id); }
  for (let i = 0;; i++) { try { await docker('exec', prefix + '-db', 'pg_isready', '-U', 'postgres'); break; } catch { if (i > 60) throw new Error('Fixture DB unavailable'); await new Promise(r => setTimeout(r, 200)); } }
  const env = ['-e', 'BH_DISPOSABLE_ASSET_TOOLS=1', '-e', 'DATABASE_URL=postgresql://postgres:disposable@db:5432/asset_test', '-e', 'REDIS_URL=redis://redis:6379', '-e', 'LOG_LEVEL=silent', '-e', 'AUTH_SECRET=disposable-fixture-transport', '-e', 'AUTH_URL=http://web:3000', '-e', 'RESEARCH_CONSOLE_ROOT=/tmp/research-native-fixture'];
  // Reuse the installed scanner image; bind only current sources/migrations and
  // its matching generated Prisma client. Never mount application secrets/data.
  const mounts = [['src', '/app/src'], ['prisma', '/app/prisma'], ['tsconfig.json', '/app/tsconfig.json'], ['tests/recon/assetTools.mts', '/app/tests/recon/assetTools.mts'], ['node_modules/.prisma', '/app/node_modules/.prisma']].flatMap(([src, dest]) => ['--mount', `type=bind,source=${resolve(src)},target=${dest},readonly`]);
  const image = process.env.RESEARCH_TEST_APP_IMAGE ?? 'bughunter-web';
  console.log(await docker('run', '--rm', '--network', prefix, ...env, ...mounts, image, 'npx', 'prisma', 'migrate', 'deploy'));
  console.log(await docker('run', '--rm', '--network', prefix, ...env, ...mounts, image, 'nuclei', '-validate', '-t', '/app/src/server/recon/templates', '-duc'));
  console.log(await docker('run', '--rm', '--network', prefix, ...env, ...mounts, image, 'node', '--import', 'tsx', 'tests/recon/assetTools.mts'));
} finally { for (const id of containers.reverse()) await docker('rm', '-f', id).catch(() => {}); await docker('network', 'rm', prefix).catch(() => {}); }
