import { constants } from 'node:fs';
import { open, mkdir, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { workspacePath, ResearchError } from './workspace';
import type { ResearchPlanReference } from '@/lib/research/planReference';

export const RESEARCH_PLAN_JSON_BYTES = 512 * 1024;
export const RESEARCH_PLAN_MARKDOWN_BYTES = 256 * 1024;
export type ResearchPlanPublication = { id: string; contentSha256: string; jsonText: string; markdownText: string };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

export function researchPlanReference(plan: ResearchPlanPublication): ResearchPlanReference {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,149}$/.test(plan.id) || !/^[a-f0-9]{64}$/.test(plan.contentSha256) || digest(plan.jsonText) !== plan.contentSha256) throw new ResearchError('Invalid Research plan integrity', 409);
  if (Buffer.byteLength(plan.jsonText) > RESEARCH_PLAN_JSON_BYTES || Buffer.byteLength(plan.markdownText) > RESEARCH_PLAN_MARKDOWN_BYTES) throw new ResearchError('Research plan exceeds export limit', 409);
  return { id: plan.id, contentSha256: plan.contentSha256, markdownSha256: digest(plan.markdownText), jsonPath: `research/plan-${plan.contentSha256}.json`, markdownPath: `research/plan-${plan.contentSha256}.md` };
}

export function researchPlanInitialFiles(plan: ResearchPlanPublication): Record<string, string> {
  const reference = researchPlanReference(plan);
  return { 'research/plan.json': plan.jsonText, 'research/plan.md': plan.markdownText, [reference.jsonPath]: plan.jsonText, [reference.markdownPath]: plan.markdownText };
}

/** Every ancestor is opened without following links. A historical writable
 * research directory is accepted only when web-owned and sticky, so operators
 * cannot replace application-owned inputs while retaining writable notes. */
async function planDirectory(root: string, workspaceId: string) {
  const path = workspacePath(root, workspaceId);
  let directory = await open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const part of resolve(path).split('/').filter(Boolean)) {
      const next = await open(`/proc/self/fd/${directory.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await directory.close(); directory = next;
    }
    const parent = await directory.stat();
    if (parent.uid !== process.getuid?.() || parent.mode & 0o022) throw new ResearchError('Unsafe Research workspace', 409);
    const research = `/proc/self/fd/${directory.fd}/research`;
    try { await mkdir(research, { mode: 0o2750 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const next = await open(research, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    await directory.close(); directory = next;
    const stat = await directory.stat();
    if (stat.uid !== process.getuid?.() || stat.mode & 0o002 || (stat.mode & 0o020 && !(stat.mode & 0o1000))) throw new ResearchError('Unsafe Research plan directory', 409);
    return directory;
  } catch (error) { await directory.close(); throw error; }
}

async function immutablePlanFile(directory: FileHandle, name: string, text: string, limit: number) {
  const path = `/proc/self/fd/${directory.fd}/${name}`;
  let file: FileHandle;
  try { file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const prior = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try {
      const stat = await prior.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.mode & 0o222 || stat.size > limit || digest(await prior.readFile('utf8')) !== digest(text)) throw new ResearchError('Research plan integrity mismatch', 409);
    } finally { await prior.close(); }
    return;
  }
  try {
    await file.chown(process.getuid!(), Number(process.env.RESEARCH_WORKSPACE_GID ?? process.getgid?.()));
    await file.writeFile(text); await file.sync(); await file.chmod(0o440);
  } finally { await file.close(); }
}

/** Explicit refresh adds immutable versions. Initial aliases are never changed. */
export async function publishResearchPlanFiles(root: string, workspaceId: string, plan: ResearchPlanPublication) {
  const reference = researchPlanReference(plan), directory = await planDirectory(root, workspaceId);
  try {
    await immutablePlanFile(directory, `plan-${plan.contentSha256}.json`, plan.jsonText, RESEARCH_PLAN_JSON_BYTES);
    await immutablePlanFile(directory, `plan-${plan.contentSha256}.md`, plan.markdownText, RESEARCH_PLAN_MARKDOWN_BYTES);
  } finally { await directory.close(); }
  return reference;
}

/** Delivery checks the exact files captured in the snapshot. It never rebuilds
 * a historical plan from the current UI view or selects a newer plan. */
export async function verifyResearchPlanFiles(root: string, workspaceId: string, reference: ResearchPlanReference) {
  if (!/^[a-f0-9]{64}$/.test(reference.contentSha256) || !/^[a-f0-9]{64}$/.test(reference.markdownSha256) || reference.jsonPath !== `research/plan-${reference.contentSha256}.json` || reference.markdownPath !== `research/plan-${reference.contentSha256}.md`) throw new ResearchError('Invalid Research plan reference', 409);
  const directory = await planDirectory(root, workspaceId);
  try {
    for (const [name, hash, limit] of [[`plan-${reference.contentSha256}.json`, reference.contentSha256, RESEARCH_PLAN_JSON_BYTES], [`plan-${reference.contentSha256}.md`, reference.markdownSha256, RESEARCH_PLAN_MARKDOWN_BYTES]] as const) {
      const file = await open(`/proc/self/fd/${directory.fd}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.mode & 0o222 || stat.size > limit || digest(await file.readFile('utf8')) !== hash) throw new ResearchError('Research plan integrity mismatch', 409);
      } finally { await file.close(); }
    }
  } finally { await directory.close(); }
}

/** Same hardened directory and immutable version policy as Research Plan inputs. */
export async function publishCoverageFiles(root:string,workspaceId:string,view:import('@/lib/research/coverage').CoverageView){
  const {coverageMarkdown,coverageContext}=await import('@/lib/research/coverage');
  const bounded=coverageContext(view);
  const jsonText=JSON.stringify(bounded,null,2)+'\n',markdown=coverageMarkdown(bounded),sha256=digest(jsonText);
  if(Buffer.byteLength(jsonText)>512*1024||Buffer.byteLength(markdown)>256*1024)throw new ResearchError('Coverage context exceeds export limit; review recorded history in BugHunter',409);
  const directory=await planDirectory(root,workspaceId);
  const reference={version:1,sha256,jsonPath:`research/coverage-${sha256}.json`,markdownPath:`research/coverage-${sha256}.md`,notice:view.notice};
  try{
    const {z}=await import('zod');const {coverageDocumentSchema}=await import('@/lib/research/coverage');
    await immutablePlanFile(directory,'coverage.schema.json',JSON.stringify(z.toJSONSchema(coverageDocumentSchema),null,2)+'\n',65536);
    await immutablePlanFile(directory,`coverage-${sha256}.json`,jsonText,512*1024);
    await immutablePlanFile(directory,`coverage-${sha256}.md`,markdown,256*1024);
    // Atomic server-owned pointer; old immutable snapshots are retained.
    const {randomUUID}=await import('node:crypto');const {rename,rm}=await import('node:fs/promises');
    const temporary=`.coverage-${randomUUID()}`,base=`/proc/self/fd/${directory.fd}`;
    try{await immutablePlanFile(directory,temporary,JSON.stringify(reference,null,2)+'\n',4096);await rename(`${base}/${temporary}`,`${base}/coverage-current.json`);}finally{await rm(`${base}/${temporary}`,{force:true});}
  }finally{await directory.close();}
  return reference;
}
