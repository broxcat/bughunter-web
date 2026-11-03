import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, constants } from 'node:fs';
import { access, open, readFile, stat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { RECON_TEMPLATE_IDS } from './nucleiPolicy';
const execute = promisify(execFile);
export const TOOL_PROBES = { subfinder: ['-version'], amass: ['-version'], assetfinder: ['-h'], httpx: ['-version'], nmap: ['--version'], ffuf: ['-V'], gobuster: ['--version'], nuclei: ['-version'] } as const;
export type ReconToolName = keyof typeof TOOL_PROBES;
export type DoctorStatus = 'READY' | 'DEGRADED' | 'INCOMPATIBLE' | 'MISSING';
const required: Record<ReconToolName, string[]> = {
  subfinder: ['-json', '-cs'], amass: ['-passive', '-d'], assetfinder: ['-subs-only'],
  httpx: ['-json', '-nfs', '-rl'], ffuf: ['-json', '-maxtime', '-rate', '-ac', '-sa'],
  nuclei: ['-jsonl', '-dr', '-duc', '-ni', '-omit-raw'], gobuster: ['--delay', '--threads', '--timeout', '--expanded', '--exclude-length', '--status-codes-blacklist'], nmap: [],
};
const pinned: Partial<Record<ReconToolName, string>> = { subfinder: '2.17.0', amass: '4.2.0', httpx: '1.12.0', ffuf: '2.1.0', gobuster: '3.8.2', nuclei: '3.11.1' };
export type ToolStatus = {
  available: boolean; version: string; capable: boolean; reason?: string; buildSha256?: string;
  status?: DoctorStatus; sha256?: string; architecture?: string; capabilities?: string[]; runtime?: string; compiler?: string;
};
export type DoctorCheck = { status: DoctorStatus; reason?: string; sha256?: string };
export type ReconDoctor = {
  schemaVersion: 1; generatedAt: string; fingerprint: string; platform: string;
  tools: Record<ReconToolName, ToolStatus>; checks: Record<string, DoctorCheck>; ready: boolean;
};
async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
/** Go 1.18+ embeds an inline build-info header; no Go SDK is needed at runtime. */
export function embeddedGoCompiler(bytes: Buffer): string | undefined {
  const start=bytes.indexOf(Buffer.from('\xff Go buildinf:', 'latin1'));
  if(start<0||start+33>=bytes.length||!(bytes[start+15]&2))return undefined;
  const length=bytes[start+32];if(length>63||start+33+length>bytes.length)return undefined;
  const value=bytes.subarray(start+33,start+33+length).toString('ascii');
  return /^go\d+\.\d+(?:\.\d+)?(?:rc\d+)?$/.test(value)?value:undefined;
}
async function binaryIdentity(path:string){
  const hash=createHash('sha256');let tail=Buffer.alloc(0),compiler:string|undefined;
  for await(const chunk of createReadStream(path)){hash.update(chunk);if(!compiler){const window=Buffer.concat([tail,chunk]);compiler=embeddedGoCompiler(window);tail=window.subarray(Math.max(0,window.length-96));}}
  return{sha256:hash.digest('hex'),...(compiler?{compiler}:{})};
}
export function executableArchitecture(header: Buffer) {
  if (header.length < 20 || !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'UNKNOWN';
  const machine = header[5] === 2 ? header.readUInt16BE(18) : header.readUInt16LE(18);
  return machine === 62 ? 'x64' : machine === 183 ? 'arm64' : `ELF-${machine}`;
}
export function parseToolVersion(tool: ReconToolName, output: string) {
  return tool === 'assetfinder' ? 'unversioned (binary SHA256 recorded)' : /(?:v|version[: ]*|Version[: ]*)(\d+\.\d+(?:\.\d+)?(?:-dev)?)/i.exec(output)?.[1] ?? 'unknown';
}
export function runtimeDependencyEvidence(output: string, commandSucceeded: boolean) {
  const evidence = output.trim();
  // ldd exits non-zero for a static executable; that explicit result is useful.
  // Missing/hung ldd or empty output cannot establish dependency readiness.
  return evidence && (commandSucceeded || /not a dynamic|statically linked/i.test(evidence)) ? evidence : `UNVERIFIED: ${evidence.slice(0, 400) || 'Runtime dependency inspection did not complete'}`;
}
export function assessTool(tool: ReconToolName, version: string, flags: string, architecture: string, runtime: string, warnings = ''): Pick<ToolStatus, 'capable' | 'status' | 'reason'> {
  if (architecture !== process.arch) return { capable: false, status: 'INCOMPATIBLE', reason: 'Binary architecture differs from the worker architecture' };
  if (!runtime.trim() || runtime.startsWith('UNVERIFIED:')) return { capable: false, status: 'INCOMPATIBLE', reason: 'Runtime dependencies could not be verified' };
  if (/not found/i.test(runtime)) return { capable: false, status: 'INCOMPATIBLE', reason: 'Required dynamic runtime dependency is missing' };
  const versionOk = tool === 'assetfinder' || tool === 'nmap' ? tool === 'assetfinder' || /^7\./.test(version) : !!pinned[tool] && (version === pinned[tool] || version.startsWith(pinned[tool]! + '-'));
  if (!versionOk || required[tool].some(flag => !flags.includes(flag))) return { capable: false, status: 'INCOMPATIBLE', reason: 'Installed CLI version/flags differ from the audited toolchain' };
  if (/WARNING: sonic\/ast|fallback to encoding\/json/i.test(warnings)) return { capable: false, status: 'INCOMPATIBLE', reason: 'Sonic runtime/toolchain mismatch; rebuild with the pinned compatible compiler' };
  return { capable: true, status: 'READY' };
}
async function findBinary(tool: string) {
  for (const root of (process.env.PATH ?? '').split(':')) {
    const path = join(root, tool); try { await access(path, constants.X_OK); return path; } catch { /* Next PATH entry. */ }
  }
  return null;
}
async function probeTool(tool: ReconToolName, path: string | null): Promise<ToolStatus> {
  if (!path) return { available: false, version: 'unavailable', capable: false, status: 'MISSING', reason: 'Binary unavailable' };
  try {
    const handle = await open(path, 'r'); const header = Buffer.alloc(64); try { await handle.read(header, 0, 64, 0); } finally { await handle.close(); }
    const architecture = executableArchitecture(header);
    const probe = await execute(path, [...TOOL_PROBES[tool]], { timeout: 5000, maxBuffer: 65536 }).catch(e => ({ stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
    const helpArgs = tool === 'amass' ? ['enum', '-h'] : tool === 'gobuster' ? ['dir', '--help'] : ['-h'];
    const help = tool === 'assetfinder' ? probe : await execute(path, helpArgs, { timeout: 5000, maxBuffer: 131072 }).catch(e => ({ stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
    const dynamic = await execute('ldd', [path], { timeout: 5000, maxBuffer: 65536 }).then(r=>({...r,success:true})).catch(e => ({ stdout: e.stdout ?? '', stderr: e.stderr ?? '',success:false }));
    const output = String(probe.stdout) + String(probe.stderr), flags = String(help.stdout) + String(help.stderr);
    const version = parseToolVersion(tool, output), identity = await binaryIdentity(path), sha256=identity.sha256;
    const runtime = runtimeDependencyEvidence(String(dynamic.stdout) + String(dynamic.stderr),dynamic.success);
    return { available: true, version, architecture, ...identity, buildSha256: sha256, runtime: runtime.includes('not found') || runtime.startsWith('UNVERIFIED:') ? runtime.slice(0, 500) : /not a dynamic|statically linked/i.test(runtime) ? 'STATIC' : 'RESOLVED', capabilities: required[tool].filter(flag => flags.includes(flag)), ...assessTool(tool, version, flags, architecture, runtime, output) };
  } catch { return { available: true, version: 'unknown', capable: false, status: 'INCOMPATIBLE', reason: 'Binary could not be inspected or executed within the audit timeout' }; }
}
async function readableFile(path: string): Promise<DoctorCheck> {
  try { const s = await stat(path); if (!s.isFile() || !s.size) throw new Error(); await access(path, constants.R_OK); return { status: 'READY', sha256: await digest(path) }; }
  catch { return { status: 'MISSING', reason: 'Required readable non-empty file is unavailable' }; }
}
async function loopbackCheck(): Promise<DoctorCheck> {
  const server = createServer((_req, res) => { res.end('recon-doctor'); });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error();
    const response = await fetch(`http://127.0.0.1:${address.port}/`, { signal: AbortSignal.timeout(1000) });
    if (await response.text() !== 'recon-doctor') throw new Error();
    return { status: 'READY' };
  } catch { return { status: 'INCOMPATIBLE', reason: 'Worker loopback HTTP transport is unavailable' }; }
  finally { server.closeAllConnections(); if (server.listening) await new Promise<void>(r => server.close(() => r())); }
}
let cached: { signature: string; report: ReconDoctor } | undefined;
/** No target network traffic. File identities invalidate the cached binary audit. */
export async function collectReconDoctor(options: { force?: boolean; root?: string } = {}): Promise<ReconDoctor> {
  const root = options.root ?? process.cwd();
  const paths = await Promise.all((Object.keys(TOOL_PROBES) as ReconToolName[]).map(async tool => [tool, await findBinary(tool)] as const));
  const resources = [
    ...['wordlists/web.txt', 'wordlists/api.txt', ...RECON_TEMPLATE_IDS.map(id => `templates/${id}.yaml`)].map(path => join(root, 'src/server/recon', path)),
    // Fixed resource paths keep Next tracing inside the intended files. A root
    // plus a generic path variable would trace unrelated project data as well.
    join(root, 'src/server/recon/nucleiPolicy.ts'),
    join(root, 'src/server/recon/toolArguments.ts'),
    join(root, 'src/lib/reconPlanner.ts'),
  ];
  const identities = await Promise.all([...paths.map(([, path]) => path), ...resources, '/etc/ssl/certs/ca-certificates.crt', '/etc/ld.so.cache', tmpdir()].map(async path => { if (!path) return null; try { const s = await stat(path); return [path, s.dev, s.ino, s.size, s.mtimeMs, s.mode]; } catch { return [path, 'MISSING']; } }));
  const signature = JSON.stringify([process.platform, process.arch, process.env.PATH, root, identities]);
  const tools = !options.force && cached?.signature === signature ? cached.report.tools : Object.fromEntries(await Promise.all(paths.map(async ([tool, path]) => [tool, await probeTool(tool, path)]))) as ReconDoctor['tools'];
  const checks: Record<string, DoctorCheck> = {};
  for (const path of resources) checks[path.slice(root.length + 1)] = await readableFile(path);
  checks.caCertificates = await readableFile('/etc/ssl/certs/ca-certificates.crt');
  checks.httpRelay = await loopbackCheck();
  let directory: string | undefined;
  try { directory = await mkdtemp(join(tmpdir(), 'bughunter-doctor-')); const file = join(directory, 'write-probe'); await writeFile(file, 'ready', { mode: 0o600 }); if (await readFile(file, 'utf8') !== 'ready') throw new Error(); checks.temporaryStorage = { status: 'READY' }; }
  catch { checks.temporaryStorage = { status: 'INCOMPATIBLE', reason: 'Private temporary storage is not writable' }; }
  finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  // Tool unavailability is decided per capability; only shared execution
  // infrastructure is globally mandatory. Build --strict requires every tool.
  const ready = ['caCertificates', 'httpRelay', 'temporaryStorage'].every(key => checks[key].status === 'READY');
  const fingerprint = createHash('sha256').update(JSON.stringify({ schemaVersion: 1, platform: `${process.platform}/${process.arch}`, tools, checks })).digest('hex');
  const report: ReconDoctor = { schemaVersion: 1, generatedAt: new Date().toISOString(), fingerprint, platform: `${process.platform}/${process.arch}`, tools, checks, ready };
  cached = { signature, report }; return report;
}
/** Historical callers retain available/version/capable fields. */
export async function inspectToolchain(): Promise<Record<string, ToolStatus>> { return (await collectReconDoctor()).tools; }
