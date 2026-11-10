import {createHash} from 'node:crypto';
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { isEvidenceRef } from "@/lib/research/hypotheses";
import { workspacePath } from "./workspace";

export class HypothesisSyncError extends Error {
  constructor(public code: string, message: string, public status = 400, public issues: { path: string; message: string }[] = []) { super(message); }
}
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** Linux descriptor-relative traversal: each child is opened under an already
 * held directory, with O_NOFOLLOW. A concurrent rename/symlink replacement cannot
 * redirect the next open to an external path. realpath + open would race here. */
export class HypothesisWorkspace {
  private constructor(private directory: FileHandle) {}
  static async open(root: string, workspaceId: string) {
    workspacePath(root, workspaceId); // absolute configured root + server UUID only
    let directory = await open("/", directoryFlags);
    try {
      for (const part of resolve(root, workspaceId).split("/").filter(Boolean)) {
        const child = await open(`/proc/self/fd/${directory.fd}/${part}`, directoryFlags);
        await directory.close(); directory = child;
      }
      const stat = await directory.stat();
      if (stat.uid !== process.getuid?.() || stat.mode & 0o002) throw new HypothesisSyncError("UNSAFE_WORKSPACE", "Unsafe workspace permissions");
      return new HypothesisWorkspace(directory);
    } catch (error) {
      await directory.close();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HypothesisSyncError("WORKSPACE_MISSING", "Research workspace is missing", 409);
      if (error instanceof HypothesisSyncError) throw error;
      throw new HypothesisSyncError("UNSAFE_WORKSPACE", "Workspace path must not contain symlinks", 400);
    }
  }
  async close() { await this.directory.close(); }
  private async artifact(ref: string) {
    if (!isEvidenceRef(ref)) throw new HypothesisSyncError("INVALID_REFERENCE", "Invalid relative workspace reference");
    const parts = ref.split("#")[0].split("/");
    let parent = this.directory;
    const handles: FileHandle[] = [];
    try {
      for (const part of parts.slice(0, -1)) {
        parent = await open(`/proc/self/fd/${parent.fd}/${part}`, directoryFlags);
        handles.push(parent);
      }
      const file = await open(`/proc/self/fd/${parent.fd}/${parts.at(-1)}`, fileFlags);
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1) { await file.close(); throw new HypothesisSyncError("UNSAFE_ARTIFACT", "Artifact must be a regular file without hardlinks"); }
      return file;
    } catch (error) {
      if (error instanceof HypothesisSyncError) throw error;
      throw new HypothesisSyncError((error as NodeJS.ErrnoException).code === "ENOENT" ? "ARTIFACT_MISSING" : "UNSAFE_ARTIFACT", "Workspace artifact is missing or unsafe");
    } finally { await Promise.all(handles.map(handle => handle.close())); }
  }
  async fingerprintReference(ref:string){
    const file=await this.artifact(ref),limit=512*1024;
    try{const before=await file.stat();if(before.size>limit)throw new HypothesisSyncError('ARTIFACT_TOO_LARGE','Evidence reference exceeds 512 KiB');
      const digest=createHash('sha256'),buffer=Buffer.alloc(16384);let size=0;
      while(true){const r=await file.read(buffer,0,Math.min(buffer.length,limit+1-size),size);if(!r.bytesRead)break;size+=r.bytesRead;if(size>limit)throw new HypothesisSyncError('ARTIFACT_TOO_LARGE','Evidence reference exceeds 512 KiB');digest.update(buffer.subarray(0,r.bytesRead));}
      const after=await file.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new HypothesisSyncError('ARTIFACT_CHANGED','Evidence artifact changed during registration',409);
      return digest.digest('hex');
    }finally{await file.close();}
  }
  async checkReference(ref: string) {
    const file = await this.artifact(ref);
    await file.close(); // Contents are never read, interpreted or imported.
  }
}
