import { spawn } from 'node:child_process';
import { claudeArguments, claudeConfigDirectory } from './claude-config.mjs';
import { reconcileClaudeMcp } from './managed-mcp.mjs';
// Native Claude control protocol: initialize and MCP status only, no model request.
export async function claudeMcpStatus(cwd, timeout = 20000) {
  const config = claudeConfigDirectory(cwd);
  const file = await reconcileClaudeMcp(config);
  const child = spawn('claude', ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', ...claudeArguments(cwd, '', false, file)], {
    cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: config, DISABLE_AUTOUPDATER: '1' }, stdio: ['pipe', 'pipe', 'ignore'],
  });
  let buffer = '', bytes = 0, timer, poll;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CLAUDE_MCP_TIMEOUT')), timeout);
      child.on('error', () => reject(new Error('CLAUDE_MCP_UNAVAILABLE')));
      child.on('exit', () => reject(new Error('CLAUDE_MCP_UNAVAILABLE')));
      const send = (id, subtype) => child.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request: { subtype } }) + '\n');
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) return reject(new Error('CLAUDE_MCP_LIMIT'));
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
          try {
            const message = JSON.parse(line);
            if (message.type !== 'control_response') continue;
            if (message.response.request_id === 'init') send('mcp', 'mcp_status');
            if (message.response.request_id === 'mcp') {
              const result = message.response.response;
              if (result?.mcpServers?.some(s => s.status === 'pending')) poll = setTimeout(() => send('mcp', 'mcp_status'), 250);
              else resolve(result);
            }
          } catch { /* Never relay raw CLI/account output. */ }
        }
      });
      send('init', 'initialize');
    });
  } finally { clearTimeout(timer); clearTimeout(poll); child.stdin.end(); child.kill('SIGTERM'); const force = setTimeout(() => child.kill('SIGKILL'), 500); force.unref(); }
}
