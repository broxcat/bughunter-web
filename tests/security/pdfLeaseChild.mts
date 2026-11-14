import { admitPdfExport } from '../../src/server/recon/pdfExportGate';
const admission = await admitPdfExport('process-' + process.pid);
console.log(JSON.stringify(admission));
if (admission.admitted) {
  if (process.argv.includes('hold')) await new Promise(resolve => process.stdin.once('data', resolve));
  await admission.release();
}
