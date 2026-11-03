import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const execute = promisify(execFile), prefix = 'bh-asset-tools-' + randomUUID().slice(0, 8), containers = [];
const docker = async (...args) => (await execute('docker', args, { timeout: 720000, maxBuffer: 1024 * 1024 })).stdout.trim();
try {
  await docker('network', 'create', '--internal', '--label', 'bughunter.asset-test=disposable', prefix);
  for (const [name, args] of [
    ['db', ['--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD=disposable', '-e', 'POSTGRES_DB=asset_test', 'postgres:16-alpine']],
    ['redis', ['redis:7-alpine']],
    ['fixture.recon.test', ['-e', 'RECON_NATIVE_WILDCARD_REDIRECT='+String(process.env.RECON_NATIVE_WILDCARD_REDIRECT==='1'), '--network-alias', 'recon.test', '--network-alias', 'api.recon.test', '--mount', `type=bind,source=${resolve('tests/recon/nativeFixture.mjs')},target=/fixture.mjs,readonly`, 'node:22-bookworm', 'node', '/fixture.mjs']],
  ]) { const id = prefix + '-' + name; await docker('run', '-d', '--name', id, '--network', prefix, '--network-alias', name, ...args); containers.push(id); }
  for (let i = 0;; i++) { try { await docker('exec', prefix + '-db', 'pg_isready', '-U', 'postgres'); break; } catch { if (i > 60) throw new Error('Fixture DB unavailable'); await new Promise(r => setTimeout(r, 200)); } }
  const fixtureIp = await docker('inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', prefix+'-fixture.recon.test');
  const env = ['-e', 'BH_DISPOSABLE_ASSET_TOOLS=1', '-e', 'RECON_NATIVE_WILDCARD_REDIRECT='+String(process.env.RECON_NATIVE_WILDCARD_REDIRECT==='1'), '-e', 'DATABASE_URL=postgresql://postgres:disposable@db:5432/asset_test', '-e', 'REDIS_URL=redis://redis:6379', '-e', 'LOG_LEVEL=silent', '-e', 'AUTH_SECRET=disposable-fixture-transport', '-e', 'AUTH_URL=http://web:3000', '-e', 'RESEARCH_CONSOLE_ROOT=/tmp/research-native-fixture'];
  // Reuse the installed scanner image; bind only current sources/migrations and
  // its matching generated Prisma client. Never mount application secrets/data.
  const mounts = [['src', '/app/src'], ['prisma', '/app/prisma'], ['tsconfig.json', '/app/tsconfig.json'], ['tests/recon/assetTools.mts', '/app/tests/recon/assetTools.mts'], ['node_modules/.prisma', '/app/node_modules/.prisma']].flatMap(([src, dest]) => ['--mount', `type=bind,source=${resolve(src)},target=${dest},readonly`]);
  const image = process.env.RESEARCH_TEST_APP_IMAGE ?? 'bughunter-web';
  console.log(await docker('run', '--rm', '--network', prefix, '--dns', fixtureIp, ...env, ...mounts, image, 'npx', 'prisma', 'migrate', 'deploy'));
  console.log(await docker('run', '--rm', '--network', prefix, '--dns', fixtureIp, ...env, ...mounts, image, 'nuclei', '-validate', '-t', '/app/src/server/recon/templates', '-duc'));
  console.log(await docker('run', '--rm', '--network', prefix, '--dns', fixtureIp, ...env, ...mounts, image, 'node', '--import', 'tsx', 'tests/recon/assetTools.mts'));
} finally { for (const id of containers.reverse()) await docker('rm', '-f', id).catch(() => {}); await docker('network', 'rm', prefix).catch(() => {}); }
