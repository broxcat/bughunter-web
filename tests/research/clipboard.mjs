import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Actual system clipboard + production React/xterm + WebSocket + real PTY.
// Meta editing commands are emulated through Chromium CDP on this Linux runner.
export async function verifyConsoleClipboard({page, context, dexec, targetId}) {
  const prefix='/tmp/clipboard-'+randomUUID(), script=prefix+'.py', receipt=prefix+'.jsonl';
  const cwd='/workspaces/research_'+targetId, session='=bughunter-'+targetId+':0.0';
  const frames=[];
  const observe=ws=>{if(ws.url().endsWith('/research-terminal/'+targetId))ws.on('framesent',frame=>{const message=JSON.parse(String(frame.payload));if(message.type==='input')frames.push(message.data);});};
  const userExec=(...args)=>dexec('setpriv','--reuid=researcher','--regid=research','--init-groups',...args);
  async function eventually(check) {
    for(let i=0;i<100;i++){try{return await check();}catch(error){if(i===99)throw error;await new Promise(r=>setTimeout(r,30));}}
  }
  const received=async()=>String(await userExec('cat',receipt)).split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const pasted=text=>'\x1b[200~'+text.replace(/\r?\n/g,'\r')+'\x1b[201~';
  let cdp, fixtureStarted=false;
  try {
    await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(page.url()).origin});
    page.on('websocket',observe);
    await page.reload();await page.getByText('Terminal: connected',{exact:true}).waitFor();
    await dexec('python3','-c',"import sys;open(sys.argv[1],'w').write(sys.argv[2])",script,await readFile(new URL('./clipboardFixture.py',import.meta.url),'utf8'));
    await userExec('tmux','respawn-pane','-k','-t',session,'-c',cwd,'python3',script,receipt);fixtureStarted=true;
    await page.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent.includes('ConsoleClipboardFixture'));
    const screen=page.locator('.xterm-screen'), input=page.locator('.xterm-helper-textarea');
    await page.evaluate(()=>{const field=document.createElement('textarea');field.id='clipboard-outside';field.setAttribute('aria-label','Clipboard test outside console');field.style.cssText='position:fixed;bottom:0;left:0;width:300px;height:40px;z-index:9999';document.body.append(field);});
    const outside=page.locator('#clipboard-outside');
    const select=async()=>{await screen.dblclick({position:{x:12,y:8}});await page.waitForFunction(()=>document.querySelector('.xterm-selection')?.childElementCount>0);};
    const focused=async()=>assert(await input.evaluate(el=>el===document.activeElement),'Clipboard must preserve terminal focus');
    const fromApp=async text=>{await outside.fill(text);await outside.press('Control+a');await outside.press('Control+c');await screen.click({position:{x:12,y:32}});await focused();};
    cdp=await context.newCDPSession(page);
    const command=async(key,action)=>{const fields={key,code:'Key'+key.toUpperCase(),windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0),modifiers:4};await cdp.send('Input.dispatchKeyEvent',{...fields,type:'keyDown',commands:[action]});await cdp.send('Input.dispatchKeyEvent',{...fields,type:'keyUp'});};

    await select();frames.length=0;await page.keyboard.press('Control+c');
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'ConsoleClipboardFixture');
    assert.deepEqual(frames,[],'Copying a selection must never send ETX');await focused();
    await outside.focus();await outside.press('Control+v');assert.equal(await outside.inputValue(),'ConsoleClipboardFixture');
    assert(await outside.evaluate(el=>el===document.activeElement),'Console must not steal another input focus');

    await select();frames.length=0;await command('c','copy');
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'ConsoleClipboardFixture');assert.deepEqual(frames,[]);await focused();

    for(const [shortcut,text] of [['Control+v','AppPaste_é_😀\nsecond line'],['Control+Shift+v','PlainPasteFixture'],['Meta+v','CmdPasteFixture']]) {
      await fromApp(text);frames.length=0;
      if(shortcut==='Meta+v')await command('v','paste');else await page.keyboard.press(shortcut);
      await eventually(()=>assert.equal(frames.join(''),pasted(text),'Exactly one normalized, bracketed paste must reach the terminal'));
      await focused();
    }
    // Native clipboard events also work when the async Clipboard API is absent.
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
    await select();frames.length=0;await page.keyboard.press('Control+c');
    await outside.fill('');await outside.focus();await outside.press('Control+v');assert.equal(await outside.inputValue(),'ConsoleClipboardFixture');assert.deepEqual(frames,[]);
    await fromApp('NoClipboardApiFixture');frames.length=0;await page.keyboard.press('Control+v');await eventually(()=>assert.equal(frames.join(''),pasted('NoClipboardApiFixture')));await focused();

    // This reaches the actual PTY driver, whose ISIG handler records SIGINT.
    frames.length=0;await page.keyboard.press('Control+c');await eventually(()=>assert.equal(frames.join(''),'\x03'));
    await eventually(async()=>assert.equal((await received()).filter(r=>r.signal==='SIGINT').length,1));
    const bytes=(await received()).filter(r=>'input' in r).map(r=>r.input).join('');
    assert.equal(bytes,['AppPaste_é_😀\nsecond line','PlainPasteFixture','CmdPasteFixture','NoClipboardApiFixture'].map(pasted).join(''),'PTY must receive each paste exactly once');
    console.log('CLIPBOARD VERIFIED: native Ctrl copy/paste in both directions, Meta copy/paste editing commands, multiline/Unicode bracketed paste once, focus retained, no async Clipboard API dependency, and real Ctrl+C SIGINT only without selection.');
  } finally {
    page.off('websocket',observe);
    await page.evaluate(()=>{document.getElementById('clipboard-outside')?.remove();delete navigator.clipboard;}).catch(()=>{});
    await cdp?.detach();
    if(fixtureStarted)await userExec('tmux','respawn-pane','-k','-t',session,'-c',cwd,'/usr/local/bin/bughunter-codex');
    await dexec('rm','-f',script,receipt);
  }
}
