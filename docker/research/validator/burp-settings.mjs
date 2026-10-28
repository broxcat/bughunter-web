import { readFileSync } from 'node:fs';
// Root-owned, non-secret operator settings survive CLI environment filtering.
export function burpSettings(env = process.env) {
  let installed = {};
  try { installed = JSON.parse(readFileSync('/etc/bughunter/burp-endpoint.json', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return Object.fromEntries(['BURP_MCP_HOST', 'BURP_MCP_PORT', 'BURP_PROXY_HOST', 'BURP_PROXY_PORT'].flatMap(key => {
    const value = env[key] ?? installed[key];
    return value === undefined ? [] : [[key, String(value)]];
  }));
}
