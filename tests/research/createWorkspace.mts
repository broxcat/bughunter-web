import { consoleBundle,writeConsoleWorkspace } from '../../src/server/research/consoleWorkspace';
import { createResearchBundle, writeResearchWorkspace } from "../../src/server/research/workspace";
import { researchTarget, researchRecon, researchSession } from "../fixtures/research";
if(process.argv.includes('--console')){
 const target=researchTarget();
 const index=process.argv.indexOf('--isolation-host');
 if(index>=0){const suffix=process.argv[index+1];if(!['alice','bob','charlie'].includes(suffix))throw new Error('Invalid fixture');target.id='m8-'+suffix;target.host=suffix+'.example.test';target.userId='owner-'+suffix;target.scope!.hostPattern=target.host;target.scope!.userId=target.userId;target.scope!.id='scope-'+suffix;target.program!.ownerId=target.userId;target.program!.id='program-'+suffix;target.program!.scopeRules=[target.host];}
 const workspaceId='research_'+target.id;
 const files=consoleBundle(target,researchRecon(),[],{...researchSession,id:index>=0?'session-'+process.argv[index+1]:researchSession.id,workspaceId});
 if(index>=0){files['findings/notes.md']='M8_PRIVATE_'+process.argv[index+1].toUpperCase();files['recon/hosts.json']='{}';files['research/plan.md']='Fixture plan';files['research/coverage.md']='Fixture coverage';}
 await writeConsoleWorkspace(process.argv[2],target.id,files);
 process.stdout.write(JSON.stringify({workspaceId}));
}else{
const result = await writeResearchWorkspace(process.argv[2], researchSession.workspaceId, createResearchBundle(researchTarget(), researchRecon(), [], researchSession));
process.stdout.write(JSON.stringify({ ...result, workspaceId: researchSession.workspaceId }));

}
