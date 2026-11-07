import {openConsoleWorkspace} from '/opt/bughunter/docker/research/validator/console-files.mjs';
const [own,foreign]=process.argv.slice(2);
const context=await openConsoleWorkspace(own);await context.root.close();
let denied=false;try{const w=await openConsoleWorkspace(foreign);await w.root.close();}catch{denied=true;}
if(!denied)throw new Error('FOREIGN_VALIDATOR_ACCEPTED');
console.log('OWN_PASS_FOREIGN_DENIED');
