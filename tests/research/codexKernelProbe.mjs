// Native Codex command execution, without a model turn or paid inference.
import {codexRead} from '/opt/bughunter/docker/research/validator/codex-rpc.mjs';
const result=await codexRead('command/exec',{command:['node','/fixtures/probe.mjs',...process.argv.slice(2)],cwd:process.cwd(),sandboxPolicy:{type:'dangerFullAccess'},timeoutMs:10000},process.cwd(),20000);
if(result.exitCode!==0)throw new Error('NATIVE_CODEX_COMMAND_FAILED');
