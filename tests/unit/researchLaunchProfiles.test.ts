import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {launchProfiles,assertLaunchProfile,codexProfileArguments,claudePermissionMode} from '@/lib/research/launchProfiles.mjs';
import {providerSelection} from '@/lib/research/provider';
import {issueLauncherTicket,verifyLauncherTicket,issueTerminalTicket,verifyTerminalTicket} from '@/lib/research/terminal';
import {launcherEngine,createLauncherSnapshot} from '../../docker/research/console/launcher.mjs';
// Pure launcher-probe tests use a UID value only; OS denial acceptance is separate.
beforeEach(()=>{vi.spyOn(process,'getuid').mockReturnValue(200001);});
afterEach(()=>{vi.restoreAllMocks();});
const help='--ask-for-approval on-request --sandbox workspace-write --dangerously-bypass-approvals-and-sandbox --permission-mode "manual" "plan"';
function runner({running=false,recorded='standard',auth=true,output=help}={}) {
  return vi.fn(async (file:string,args:string[])=>{
    if(file==='tmux') {
      if(!running)throw Object.assign(new Error(),{code:1});
      if(args[0]==='show-environment') {if(recorded==='')throw Object.assign(new Error(),{code:1});return {stdout:`BUGHUNTER_LAUNCH_PROFILE=${recorded}`};}
      return {stdout:''};
    }
    if(args[0]==='--version')return {stdout:file==='codex'?'codex-cli 0.165.0':'2.1.312 (Claude Code)'};
    if(args[0]==='--help')return {stdout:output};
    if(file==='codex'&&!auth)throw Object.assign(new Error('PRIVATE'),{code:1});
    return {stdout:JSON.stringify({loggedIn:auth,email:'PRIVATE',token:'SECRET'})};
  });
}
describe('verified Research launch profiles',()=>{
  it.each([['codex','standard'],['codex','yolo'],['claude','standard'],['claude','plan']])('allows %s %s only as a server-owned selection',(provider,profile)=>{
    expect(providerSelection.parse({provider,profile})).toEqual({provider,profile});expect(assertLaunchProfile(provider,profile)).toBe(profile);
  });
  it.each([{provider:'claude',profile:'yolo'},{provider:'codex',profile:'plan'},{provider:'codex',profile:'standard;id'},{provider:'codex',command:'sh'},{provider:'claude',cwd:'/tmp'},{provider:'codex',env:{}},{provider:'codex',model:'invented'},{provider:'claude',endpoint:'http://evil'}])('rejects non-allowlisted input %j',value=>{expect(providerSelection.safeParse(value).success).toBe(false);});
  it('preserves distinct native sandbox/permission semantics without widening Claude tools',()=>{
    expect(codexProfileArguments('standard')).toEqual(['--ask-for-approval','on-request','--sandbox','workspace-write']);
    expect(codexProfileArguments('yolo')).toEqual(['--yolo']);expect(claudePermissionMode('standard')).toBe('manual');expect(claudePermissionMode('plan')).toBe('plan');
    expect(()=>codexProfileArguments('plan')).toThrow();expect(()=>claudePermissionMode('yolo')).toThrow();
    expect(launchProfiles.claude).not.toContain('bypassPermissions');
  });
  it.each(['codex','claude'] as const)('reports authenticated/required %s status without secrets',async provider=>{
    for(const auth of [true,false]){
      const status=await launcherEngine('host',provider,runner({auth}));expect(status.authentication).toBe(auth?'authenticated':'required');expect(JSON.stringify(status)).not.toMatch(/PRIVATE|SECRET/);expect(status.profiles).toEqual(launchProfiles[provider]);
    }
  });
  it('hides unsupported profiles instead of assuming CLI parity',async()=>{expect((await launcherEngine('host','claude',runner({output:'--model'}))).profiles).toEqual([]);});
  it('records profile identity and retains legacy untagged defaults',async()=>{
    expect((await launcherEngine('host','codex',runner({running:true,recorded:'standard'}))).runningProfile).toBe('standard');
    expect((await launcherEngine('host','codex',runner({running:true,recorded:''}))).runningProfile).toBe('yolo');
    expect((await launcherEngine('host','claude',runner({running:true,recorded:''}))).runningProfile).toBe('standard');
    expect((await launcherEngine('host','claude',runner({running:true,recorded:'hostile'}))).profiles).toEqual([]);
  });
  it('single-flights and expires readiness per host without inference',async()=>{
    let now=0;const run=runner(),snapshot=createLauncherSnapshot({run,now:()=>now});
    await Promise.all([snapshot('a'),snapshot('a')]);const count=run.mock.calls.length;await snapshot('a');expect(run).toHaveBeenCalledTimes(count);
    await snapshot('b');expect(run.mock.calls.length).toBeGreaterThan(count);now=16000;const before=run.mock.calls.length;await snapshot('a');expect(run.mock.calls.length).toBeGreaterThan(before);
    expect(run.mock.calls.every(([,args])=>['--version','--help','login','auth','has-session','show-environment'].includes(args[0]))).toBe(true);
    await expect(snapshot('../host')).rejects.toThrow();
  });
  it('bounds active host probes while retaining in-flight single-flight requests',async()=>{
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),base=runner();
    const snapshot=createLauncherSnapshot({run:async(file:string,args:string[])=>{await gate;return base(file,args);}});
    const pending=['a','b','c','d'].map(id=>snapshot(id));
    await expect(snapshot('e')).rejects.toThrow('LAUNCHER_BUSY');release();await Promise.all(pending);expect((await snapshot('e'))).toHaveLength(2);
  });
  it('fails closed on ambiguous tmux probe failure',async()=>{
    const run=runner();await expect(launcherEngine('host','codex',async(file:string,args:string[])=>{if(file==='tmux')throw Object.assign(new Error(),{code:'ETIMEDOUT'});return run(file,args);})).rejects.toThrow();
  });
  it('separates readiness from terminal authorization and signs the selected profile',()=>{
    const keys=generateKeyPairSync('ed25519'),priv=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),pub=keys.publicKey.export({type:'spki',format:'pem'}).toString();
    const token=issueLauncherTicket('host',priv);expect(verifyLauncherTicket(token,pub).targetId).toBe('host');expect(()=>verifyTerminalTicket(token,pub)).toThrow();expect(()=>verifyLauncherTicket(token,pub,Date.now()+31000)).toThrow();
    const terminal=issueTerminalTicket({targetId:'host',userId:'owner',sessionId:'session',policySha256:'a'.repeat(64),provider:'codex',profile:'standard'},priv).token;
    expect(verifyTerminalTicket(terminal,pub).profile).toBe('standard');expect(()=>verifyLauncherTicket(terminal,pub)).toThrow();
  });
});
