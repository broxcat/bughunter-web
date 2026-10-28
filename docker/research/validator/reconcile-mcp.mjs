import { readdir } from 'node:fs/promises';
import { claudeConfigDirectory } from './claude-config.mjs';
import { reconcileClaudeMcp } from './managed-mcp.mjs';
for (const name of await readdir('/workspaces')) {
  if (!/^research_[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(name)) continue;
  await reconcileClaudeMcp(claudeConfigDirectory('/workspaces/' + name));
}
