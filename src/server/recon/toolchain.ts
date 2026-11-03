import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const execute=promisify(execFile);
export const TOOL_PROBES = { subfinder:['-version'], amass:['-version'], assetfinder:['-h'], httpx:['-version'], nmap:['--version'], ffuf:['-V'], nuclei:['-version'] } as const;
const required: Record<string,string[]> = {subfinder:['-json','-cs'],amass:['-passive','-d'],assetfinder:['-subs-only'],httpx:['-json','-nfs','-rl'],ffuf:['-json','-maxtime','-rate','-ac','-sa'],nuclei:['-jsonl','-dr','-duc','-ni','-omit-raw'],nmap:[]};
export type ToolStatus={available:boolean;version:string;capable:boolean;reason?:string;buildSha256?:string};
export async function inspectToolchain():Promise<Record<string,ToolStatus>> {
  return Object.fromEntries(await Promise.all(Object.entries(TOOL_PROBES).map(async([tool,args])=>{
    try {
      const path=(await Promise.all((process.env.PATH??'').split(':').map(async root=>{const p=join(root,tool);try{await access(p,constants.X_OK);return p;}catch{return null;}}))).find(Boolean);if(!path)throw new Error('missing');
      const probe=await execute(path,[...args],{timeout:5000,maxBuffer:65536}).catch(e=>({stdout:e.stdout??'',stderr:e.stderr??''}));
      const help=tool==='assetfinder'?probe:await execute(path,tool==='amass'?['enum','-h']:['-h'],{timeout:5000,maxBuffer:131072}).catch(e=>({stdout:e.stdout??'',stderr:e.stderr??''}));
      const output=String(probe.stdout)+String(probe.stderr), flags=String(help.stdout)+String(help.stderr);
      const version=tool==='assetfinder'?'unversioned (binary build hash recorded)':(/(?:v|version[: ]*|Version[: ]*)(\d+\.\d+(?:\.\d+)?(?:-dev)?)/i.exec(output)?.[1]??'unknown');
      const capable=required[tool].every(flag=>flags.includes(flag)) && (tool!=='nmap'||/Nmap version 7\./.test(output));
      return [tool,{available:true,version,capable,...(!capable?{reason:'Installed CLI does not expose the audited required flags'}:{}),...(tool==='assetfinder'?{buildSha256:createHash('sha256').update(await readFile(path)).digest('hex')}: {})}];
    }catch{return[tool,{available:false,version:'unavailable',capable:false,reason:'Binary unavailable'}];}
  })));
}
