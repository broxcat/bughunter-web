import {reconnectWorkspaceBurp} from '../console/burp-reconnect.mjs';
import { providerStatus } from '../console/providers.mjs';
import { diagnoseProviderBurp } from '../console/mcp-diagnostics.mjs';
import { openConsoleWorkspace } from '../validator/console-files.mjs';
const workspace=await openConsoleWorkspace(); await workspace.root.close();
const provider=process.argv[2];
if(!['codex','claude'].includes(provider))throw new Error('INVALID_PROVIDER');
console.log(JSON.stringify(process.argv[3]==='reconnect' ? await reconnectWorkspaceBurp(process.cwd()) : process.argv[3]==='mcp' ? await diagnoseProviderBurp(provider,process.cwd()) : await providerStatus(provider,undefined,process.cwd())));
