import {verifyReconDelivery} from '../../../src/lib/research/reconDelivery.ts';
import { readFile } from 'node:fs/promises';
import { verifyCollectorTicket, verifyTerminalTicket, verifyStopTicket } from '../../../src/lib/research/terminal.ts';
import { openTrustedConsoleWorkspace } from '../validator/console-files.mjs';
const token = await new Promise(resolve => { let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', part => { input+=part; if(input.length>4096)process.exit(1); }); process.stdin.on('end',()=>resolve(input)); });
const key=await readFile('/run/research-terminal/public.pem','utf8');
if(process.argv[2]==='inventory'){console.log(JSON.stringify(verifyCollectorTicket(token,key)));process.exit(0);}
if(process.argv[2]==='stop'){const claims=verifyStopTicket(token,key);console.log(JSON.stringify(claims));process.exit(0);}
const claims=process.argv[2]==='recon'?verifyReconDelivery(token,key):verifyTerminalTicket(token,key);
const workspace=await openTrustedConsoleWorkspace(`/workspaces/research_${claims.targetId}`);
try {
 if(workspace.policy.sessionId!==claims.sessionId||workspace.policySha256!==claims.policySha256)throw new Error('POLICY_CHANGED');
 console.log(JSON.stringify({targetId:claims.targetId,workspaceId:`research_${claims.targetId}`,sessionId:claims.sessionId,policySha256:claims.policySha256,...(process.argv[2]==='recon'?{provider:claims.provider,deliveryId:claims.deliveryId,exp:claims.exp}:{})}));
} finally { await workspace.root.close(); }
