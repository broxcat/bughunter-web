import { writeFile } from 'node:fs/promises';
import { collectReconDoctor } from '../../src/server/recon/toolchain';
const report = await collectReconDoctor({ force: true });
const output = process.argv.indexOf('--output');
if (output !== -1) { if (!process.argv[output + 1]) throw new Error('Output path required'); await writeFile(process.argv[output + 1], JSON.stringify(report, null, 2) + '\n', { mode: 0o644 }); }
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--strict') && (!report.ready || Object.values(report.checks).some(c => c.status !== 'READY') || Object.values(report.tools).some(t => t.status !== 'READY'))) process.exitCode = 1;
