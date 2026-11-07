import { open, constants, realpathSync } from "node:fs";
import { open as openFile } from "node:fs/promises";
import { promisify } from "node:util";
import { hypothesesDocumentSchema, HYPOTHESES_MAX_BYTES, safeHypothesisIssues, hypothesisEvidence, researchBindingError } from "../../../src/lib/research/hypotheses.ts";
import { openConsoleWorkspace } from './console-files.mjs';
// Local validation only; no HTTP, DB or subprocesses. Print field diagnostics,
// never source text or credentials from the untrusted document.
const cwd = realpathSync(process.cwd());
async function readBounded(path, max) {
  const file = await openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) throw new Error("file");
    const buffer = Buffer.alloc(max + 1); let size = 0;
    while (size < buffer.length) { const r = await file.read(buffer, size, buffer.length - size, size); if (!r.bytesRead) break; size += r.bytesRead; }
    if (size > max) throw new Error("size");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
  } finally { await file.close(); }
}
// The CLI also uses anchored descriptors for its mutable research directory.
async function checkArtifact(ref) {
  let parent = await openFile(cwd, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const parts = ref.split("#")[0].split("/");
    for (const part of parts.slice(0, -1)) {
      const child = await openFile(`/proc/self/fd/${parent.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await parent.close(); parent = child;
    }
    const file = await openFile(`/proc/self/fd/${parent.fd}/${parts.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { const stat = await file.stat(); if (!stat.isFile() || stat.nlink !== 1) throw new Error("artifact"); }
    finally { await file.close(); }
  } finally { await parent.close(); }
}
let research;
try {
  const authorization = await openConsoleWorkspace(cwd);
  await authorization.root.close();
  const consoleWorkspace = /^\/workspaces\/research_[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(cwd);
  if (!consoleWorkspace && !/^\/workspaces\/[0-9a-f-]{36}$/.test(cwd)) throw new Error("cwd");
  research = await promisify(open)(`${cwd}/${consoleWorkspace ? "findings" : "research"}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const document = JSON.parse(await readBounded(`/proc/self/fd/${research}/hypotheses.json`, HYPOTHESES_MAX_BYTES));
  const parsed = hypothesesDocumentSchema.safeParse(document);
  if (!parsed.success) {
    for (const issue of safeHypothesisIssues(parsed.error)) console.error(`${issue.path || "document"}: ${issue.message}`);
    process.exitCode = 1;
  } else {
    const session = JSON.parse(await readBounded(consoleWorkspace ? `${cwd}/.agents/bughunter/session.json` : `/proc/self/fd/${research}/session.json`, 16384));
    const sessionId = typeof session.source === "string" ? session.source.replace(/^ResearchSession /, "") : null;
    if (parsed.data.sessionId !== sessionId) { console.error("sessionId: does not match research/session.json"); process.exitCode = 1; }
    else {
      const target = JSON.parse(await readBounded(`${cwd}/${consoleWorkspace ? ".agents/bughunter/target.json" : "target.json"}`, 65536));
      const checked = new Set();
      for (const [index, hypothesis] of parsed.data.hypotheses.entries()) {
        if ('targetId' in hypothesis && researchBindingError(hypothesis, { id: target.id, host: target.host, scheme: target.scheme ?? 'https' })) {
          console.error(`hypotheses.${index}: target/host/location differs from immutable target.json`); process.exitCode = 1;
        }
        for (const [entry, evidence] of hypothesisEvidence(hypothesis).entries()) {
          const path = evidence.ref.split("#")[0];
          if (checked.has(path)) continue;
          if (checked.size >= 1000) throw new Error("reference limit");
          try { await checkArtifact(evidence.ref); checked.add(path); }
          catch { console.error(`hypotheses.${index}.evidence.${entry}.ref: artifact missing or unsafe`); process.exitCode = 1; }
        }
      }
      if (!process.exitCode) console.log(`OK — ${parsed.data.hypotheses.length} hypotheses`);
    }
  }
} catch {
  console.error("Invalid or missing research/hypotheses.json/session.json (maximum hypotheses.json size: 1 MiB). Run from a workspace root; symlinks are not accepted.");
  process.exitCode = 1;
} finally { if (research !== undefined) await promisify((await import("node:fs")).close)(research); }
