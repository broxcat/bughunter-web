// Root-owned overrides also upgrade existing immutable workspace configs.
export function consoleMcpOverrides(cwd) {
  if (!/^\/workspaces\/research_[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(cwd)) return [];
  return ['-c', `mcp_servers.burp={command="/usr/local/bin/bughunter-portswigger-mcp",cwd=${JSON.stringify(cwd)},required=false,startup_timeout_sec=15,tool_timeout_sec=30}`];
}
