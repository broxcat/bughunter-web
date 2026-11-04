import { describe, expect, it } from 'vitest';
import { scannerEnvironment } from '@/server/scanners/environment.mjs';
import { spawnSync } from 'node:child_process';

describe('scanner child environment', () => {
  it('retains runtime paths/locale/CA configuration but strips worker and session secrets', () => {
    expect(scannerEnvironment({ PATH: '/bin', HOME: '/runtime', TMPDIR: '/tmp', LANG: 'C.UTF-8', SSL_CERT_FILE: '/ca.pem', DATABASE_URL: 'private-db', CREDENTIALS_ENCRYPTION_KEY: 'private-master', AUTH_SECRET: 'private-auth', OPENROUTER_API_KEY: 'private-api', TARGET_COOKIE: 'private-cookie', NODE_OPTIONS: '--require private.js' })).toEqual({ PATH: '/bin', HOME: '/runtime', TMPDIR: '/tmp', LANG: 'C.UTF-8', SSL_CERT_FILE: '/ca.pem' });
  });
  it('the actual supervisor does not forward secrets even when its own caller supplied them', () => {
    const code = 'process.stdout.write(JSON.stringify({secret:process.env.BUGHUNTER_TEST_PRIVATE_TOKEN??null,path:Boolean(process.env.PATH),home:process.env.HOME}))';
    const owner = `const{spawn}=require('node:child_process');const p=spawn(process.execPath,['src/server/scanners/toolProcess.mjs',process.execPath,'-e',${JSON.stringify(code)}],{env:{...process.env,BUGHUNTER_TEST_PRIVATE_TOKEN:'PRIVATE_SESSION'},stdio:['ignore','inherit','inherit','ipc']});p.on('message',()=>{});p.on('close',c=>process.exit(c??1));`;
    const run = spawnSync(process.execPath, ['-e', owner], { encoding: 'utf8', timeout: 5000 });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ secret: null, path: true, home: process.env.HOME });
    expect(run.stdout + run.stderr).not.toContain('PRIVATE_SESSION');
  });
});
