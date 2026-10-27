// Host entrypoint runs both legacy preservation and the real public console smoke.
// Inside web, the explicit opt-in preserves the container-only legacy smoke command.
if (process.env.BH_FINAL_STACK_SMOKE === '1') {
  await import('./researchFinalStack.mjs');
} else {
  const { spawn } = await import('node:child_process');
  const run = (file,args) => new Promise((resolve,reject)=>{const child=spawn(file,args,{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Final smoke failed')));});
  await run('docker',['compose','exec','-T','-e','BH_FINAL_STACK_SMOKE=1','web','node','--import','tsx','tests/e2e/researchFinalStack.mjs']);
  await import('./researchFinalConsole.mjs');
}
