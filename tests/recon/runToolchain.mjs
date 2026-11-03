import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const execute = promisify(execFile);
const image = process.env.RECON_TOOLCHAIN_TEST_IMAGE ?? process.env.RESEARCH_TEST_APP_IMAGE ?? 'bughunter-web';
// Existing images are not rebuilt implicitly; CI's Docker build has the same
// smoke gate. This invocation cannot reach any non-local target/network.
const result = await execute('docker', ['run', '--rm', '--network', 'none', '--mount', `type=bind,source=${resolve('scripts/recon/toolchain-smoke.mjs')},target=/tmp/toolchain-smoke.mjs,readonly`, '--mount', `type=bind,source=${resolve('src/server/recon/templates')},target=/tmp/recon-templates,readonly`, '-e', 'RECON_SMOKE_TEMPLATES=/tmp/recon-templates', image, 'node', '/tmp/toolchain-smoke.mjs'], { timeout: 240000, maxBuffer: 2 * 1024 * 1024 });
console.log(result.stdout); if (result.stderr) process.stderr.write(result.stderr);
