import { spawn } from 'node:child_process';
import { openConsoleWorkspace } from './console-files.mjs';
const workspace = await openConsoleWorkspace(), policy = workspace.policy;
await workspace.root.close();
const args = ['/opt/bughunter/node_modules/@playwright/mcp/cli.js', '--headless', '--browser=chromium', '--executable-path=/usr/local/bin/bughunter-chromium', '--no-sandbox', '--isolated', '--block-service-workers', '--no-webmcp', '--proxy-server=http://127.0.0.1:8080', '--ignore-https-errors', `--user-agent=${policy.requiredUserAgent}`, `--allowed-origins=${policy.scheme}://${policy.targetHost}`, '--init-page=/opt/bughunter/docker/research/validator/playwright-scope.cjs', '--output-dir=requests/browser', '--output-max-size=16777216', '--timeout-navigation=15000'];
const child = spawn('node', args, { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright', BUGHUNTER_BROWSER_POLICY: JSON.stringify({ host: policy.targetHost, scheme: policy.scheme, port: policy.port, requiredUserAgent: policy.requiredUserAgent }) } });
for (const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
