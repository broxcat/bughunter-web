// Pre-migration fixture: the real former runtime identity, no model turn.
import {codexRead} from '/opt/bughunter/docker/research/validator/codex-rpc.mjs';
import fs from 'node:fs';
const threads={};
for(const suffix of ['alice','bob']){
 const cwd='/workspaces/research_m8-'+suffix;
 const result=await codexRead('thread/inject_items',{items:[{type:'message',role:'user',content:[{type:'input_text',text:'LEGACY_PRIVATE_'+suffix.toUpperCase()}]}]},cwd,15000,'persistent');
 threads[suffix]=result.thread;
}
fs.writeFileSync('/tmp/legacy-threads.json',JSON.stringify(threads));
