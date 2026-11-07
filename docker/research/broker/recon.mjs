import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stageReconContext} from '../console/recon-context.mjs';
const token=await new Promise(resolve=>{let value='';process.stdin.setEncoding('utf8');process.stdin.on('data',part=>{value+=part;if(value.length>4096)process.exit(1);});process.stdin.on('end',()=>resolve(value));});
const execute=promisify(execFile);
const run=(file,args,options)=>{if(file!=='tmux')throw new Error('INVALID_OPERATION');return execute('tmux',['-S',`/var/lib/bughunter-homes/${process.getuid()}/run/tmux.sock`,...args],options);};
console.log(JSON.stringify(await stageReconContext(token,await readFile('/run/research-terminal/public.pem','utf8'),run)));
