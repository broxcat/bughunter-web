import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createInterface } from 'node:readline';
import { diagnoseProviderBurp } from '../console/mcp-diagnostics.mjs';
const cwd = process.argv[2];
process.chdir(cwd);
const client = new Client({ name: 'bughunter-rebuild-acceptance', version: '1' });
await client.connect(new StdioClientTransport({ command: '/usr/local/bin/bughunter-burp-passive-mcp', cwd, stderr: 'pipe' }));
for await (const command of createInterface({ input: process.stdin })) {
  if (command === 'exit') break;
  try {
    const result = await client.callTool({ name: 'burp_status', arguments: {} }, undefined, { timeout: 10000 });
    const upstream = JSON.parse(result.content[0].text).upstream;
    assert.equal(upstream, command === 'offline' ? 'UNAVAILABLE' : 'AVAILABLE');
    if (command !== 'offline') {
      for (const provider of ['codex', 'claude']) {
        const diagnostic = await diagnoseProviderBurp(provider, cwd);
        assert.equal(diagnostic.status, 'connected', JSON.stringify(diagnostic));
        assert(diagnostic.toolCount >= 3);
        console.log(JSON.stringify(diagnostic));
      }
    }
    console.log('ACCEPTANCE_OK');
  } catch (error) { console.log('ACCEPTANCE_FAILED ' + error.message); process.exitCode = 1; break; }
}
await client.close();
