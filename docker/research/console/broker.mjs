import {launcherStatusSchema} from '../../../src/lib/research/provider.ts';
import { spawn } from 'node:child_process';
export const brokerClient='/opt/bughunter/docker/research/broker/client.py';
// Signed tickets travel over stdin, never process argv visible through /proc.
/** @param {Record<string, unknown>} request
 * @returns {Promise<{stdout: string, code?: number, ready?: boolean}>} */
export async function brokerRequest(request) {
  return new Promise((resolve,reject)=>{
    const child=spawn('python3',[brokerClient,'--request-stdin'],{cwd:'/tmp',env:{PATH:'/usr/local/bin:/usr/bin:/bin'},stdio:['pipe','pipe','ignore']});
    let output='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(new Error('RESEARCH_ISOLATION_REQUIRED'));else resolve(value);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(true);},30000);
    child.on('error',()=>finish(true));child.stdin.on('error',()=>finish(true));
    child.stdout.on('data',part=>{output+=part;if(output.length>128*1024){child.kill('SIGKILL');finish(true);}});
    child.on('close',code=>{try{if(code!==0)throw new Error();finish(false,JSON.parse(output));}catch{finish(true);}});
    child.stdin.end(JSON.stringify(request));
  });
}
export function workspaceRequest(targetId,operation,provider='codex',profile=provider==='codex'?'yolo':'standard') {
  return brokerRequest({operation,targetId,provider,profile});
}
export async function isolatedLauncherEngine(targetId,provider) {
  return launcherStatusSchema.parse([JSON.parse((await workspaceRequest(targetId,'inspect',provider)).stdout)])[0];
}
