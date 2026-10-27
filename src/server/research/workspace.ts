import { randomUUID, createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, lstat, open, rename, rm, chown, chmod } from "node:fs/promises";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { persistedCorpusSchema } from "@/server/recon/corpus";
import { safeObservationUrl, redactObservationText } from "@/lib/observationSafety";
import { matchesHost, normalizeFqdn } from "@/lib/bountyProgram";
import { scanRejection } from "@/server/execution";
import { hypothesesJsonSchema } from "@/lib/research/hypotheses";
import { RESEARCH_RULES, HYPOTHESES } from "./rules";
import { bundleZip } from "./zip";
import type { Prisma } from "@prisma/client";

// Explicit projection: no Prisma credential or AI secret can enter the exporter.
export const researchTargetSelect = {
  id: true, userId: true, host: true, scheme: true, active: true,
  scope: { select: { id: true, userId: true, hostPattern: true, status: true, rulesOfEngagement: true, scopeDetails: true, outOfScope: true, disclosurePolicy: true, safeHarbor: true, legalTerms: true, eligibilityCriteria: true, reportingFormat: true } },
  program: { select: { id: true, ownerId: true, companyName: true, requiredUserAgent: true, outOfScope: true, qualifying: true, nonQualifying: true } },
  credentials: { select: { label: true, purpose: true, sessionStatus: true } },
} satisfies Prisma.TargetSelect;
export type ResearchTarget = Prisma.TargetGetPayload<{ select: typeof researchTargetSelect }>;
export type ResearchRecon = { id: string; reconCorpus: unknown } | null;
export type ResearchFinding = { id: string; title: string; severity: string; vulnClass: string | null; reviewStatus: string; location: string | null };
export class ResearchError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function assertResearchTarget(target: ResearchTarget, userId: string) {
  if (target.userId !== userId || target.scope.userId !== userId || target.program?.ownerId !== userId) throw new ResearchError("Target not found", 404);
  const rejection = scanRejection(target);
  if (rejection) throw new ResearchError(rejection);
  try { if (normalizeFqdn(target.host) !== target.host || !matchesHost(target.host, target.scope.hostPattern)) throw new Error(); }
  catch { throw new ResearchError("Selected host does not match its authorized scope"); }
  // Legacy free-text exclusions are authoritative too. Host-shaped entries in
  // prose are conservative denials; ambiguous prose must be reviewed by the user.
  const exclusions = target.scope.outOfScope?.toLowerCase().match(/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? [];
  if (exclusions.some(rule => matchesHost(target.host, rule))) throw new ResearchError("Host is explicitly out of scope");
}

/** Free text is never trusted for credentials. No raw HTTP bodies, headers,
 * credential material, finding evidence or accessInfo is serialized. */
export function exportText(value: string): string {
  return redactObservationText(value)
    .replace(/\b(?:api.?key(?:cipher)?|\w+cipher|bearer|token|DATABASE_URL|REDIS_URL|AUTH_SECRET|CREDENTIALS_ENCRYPTION_KEY)\s*["']?\s*[:= ]\s*[^\r\n]+/gi, "[REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat)[_-][a-zA-Z0-9_-]+/g, "[REDACTED]")
    .replace(/https?:\/\/[^\s<>"`]+/gi, url => safeObservationUrl(url))
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .slice(0, 20000);
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export function createResearchBundle(target: ResearchTarget, recon: ResearchRecon, findings: ResearchFinding[], session: { id: string; workspaceId: string; createdAt: Date }) {
  assertResearchTarget(target, target.userId);
  const program = target.program!;
  const sshPort = /^\d{1,5}$/.test(process.env.RESEARCH_SSH_PORT ?? "") ? process.env.RESEARCH_SSH_PORT : "2222";
  const provenance = { source: recon ? `ScanRun ${recon.id}` : `Target ${target.id}`, generatedAt: session.createdAt.toISOString() };
  const policy = ["# Program policy", `Source: Scope ${target.scope.id} / Program ${program.id}`, ...Object.entries({ rulesOfEngagement: target.scope.rulesOfEngagement, scopeDetails: target.scope.scopeDetails, outOfScope: target.scope.outOfScope, disclosurePolicy: target.scope.disclosurePolicy, safeHarbor: target.scope.safeHarbor, legalTerms: target.scope.legalTerms, eligibilityCriteria: target.scope.eligibilityCriteria, reportingFormat: target.scope.reportingFormat }).filter(([, value]) => value).map(([key, value]) => `## ${key}\n\n${exportText(value!)}`), `## Qualifying\n\n${program.qualifying.join(", ") || "Not specified."}`, `## Non-qualifying\n\n${program.nonQualifying.join(", ") || "Not specified."}`].join("\n\n") + "\n";
  const scope = `# Authorized Scope\n\nProgram: ${exportText(program.companyName)}\n\nSource: Target ${target.id}, Scope ${target.scope.id}; snapshot ${provenance.generatedAt}.\nRecheck current authorization in BugHunter before each session.\n\n## Selected target\n\n${target.host}\n\n## Explicitly authorized hosts\n\n- ${target.host}\n\nOnly this selected concrete host is authorized by this workspace.\n\n## Excluded\n\n${program.outOfScope.map(host => `- ${host}`).join("\n") || "No structured host exclusions recorded."}\n${target.scope.outOfScope ? exportText(target.scope.outOfScope) : ""}\n\n## Required User-Agent\n\n${exportText(program.requiredUserAgent)}\n\n## Program rules\n\n${target.scope.rulesOfEngagement ? exportText(target.scope.rulesOfEngagement) : "No additional rules recorded."}\nSee program-policy.md for the other recorded policy fields.\n\n## Safety rule\n\nDiscovery does not grant authorization. Hosts discovered during research MUST NOT\nbe treated as authorized unless they appear in the explicitly authorized scope above.\nDo not follow redirects to another host. Authorization revocation requires stopping.\n`;
  const files: Record<string, string> = {
    "AGENTS.md": RESEARCH_RULES,
    "README.md": `# BugHunter Research Workspace\n\n${exportText(program.companyName)} / ${target.host}\n\nRead AGENTS.md and scope.md before doing anything.\n\nSSH from the Docker host (use your configured SSH port/key):\n\n\`\`\`sh\nssh -i ~/.ssh/bughunter_research -p ${sshPort} researcher@127.0.0.1\ncd /workspaces/${session.workspaceId}\nbughunter-codex\n# Equivalent: codex --yolo\n\`\`\`\n\nBootstrap prompt:\n\nRead AGENTS.md, scope.md and all existing recon evidence. Build an initial map of\nthe application and create only evidence-backed hypotheses in research/hypotheses.json, with a human-readable view in research/hypotheses.md.\n\n${recon ? `Recon source: ScanRun ${recon.id}.` : "No Recon evidence was available at creation; do not invent observations."}\nExport contains metadata only, no target credentials or raw HTTP responses.\nNo remote Git repository or automatic Finding creation is configured.\n\nHypothesis workflow:\n1. Inspect evidence.\n2. Create/update research/hypotheses.json (contract v1; see research/hypothesis.schema.json).\n3. Keep research/hypotheses.md human-readable.\n4. Run bughunter-validate-hypotheses.\n5. Return to BugHunter and click Sync from workspace.\nBugHunter stores imported hypotheses and revisions read-only; workspace edits never create Findings.\nInput files are read-only; research/, evidence/ and scripts/ are writable.\nZIP downloads preserve this initial bundle, excluding subsequent local research edits.\n127.0.0.1 inside the runner refers to the runner, not the Docker host.\n`,
    "scope.md": scope, "program-policy.md": policy,
    "target.json": json({ source: `Target ${target.id}`, generatedAt: provenance.generatedAt, id: target.id, host: target.host, scheme: target.scheme ?? "https", requiredUserAgent: exportText(program.requiredUserAgent), authenticatedContexts: target.credentials.map(c => ({ label: exportText(c.label), purpose: c.purpose, available: true, sessionStatus: c.sessionStatus, credentialsExported: false })) }),
    "evidence/README.md": "# Evidence\n\nStore minimal captured evidence here. Label OBSERVATION, INFERENCE, EVIDENCE and IMPACT.\nCite exact requests/responses and timestamps. Redact credentials and unrelated user data.\n",
    "research/hypotheses.md": HYPOTHESES,
    "research/hypotheses.json": json({ version: 1, sessionId: session.id, hypotheses: [] }),
    "research/hypothesis.schema.json": json(hypothesesJsonSchema()),
    "research/notes.md": "# Research notes\n\nRecord observations, inferences, negative tests and exact evidence references.\n",
    "research/session.json": json({ source: `ResearchSession ${session.id}`, workspaceId: session.workspaceId, targetId: target.id, createdAt: provenance.generatedAt, reconScanRunId: recon?.id ?? null }),
    "scripts/README.md": "# Local research helpers\n\nOnly evidence-driven, in-scope, minimal-impact tests. No generic payload checklist.\n",
  };
  const safeUrl = (value: string) => { try { const u = new URL(value); return /^https?:$/.test(u.protocol) && u.host === target.host && !u.username && !u.password ? safeObservationUrl(value) : null; } catch { return null; } };
  const parsed = persistedCorpusSchema.safeParse(recon?.reconCorpus);
  if (parsed.success) {
    const c = parsed.data;
    const urls = [...new Set(c.urls.map(safeUrl).filter((u): u is string => Boolean(u)))];
    // Deterministic metadata-only transformations. Never spread arbitrary JSON.
    files["recon/corpus.json"] = json({ ...provenance, capturedAt: c.capturedAt, ...(c.authenticated !== undefined ? { authenticated: c.authenticated } : {}), urls });
    if (urls.length) files["recon/endpoints.json"] = json({ ...provenance, endpoints: urls.map(url => ({ url, sourceField: "reconCorpus.urls" })) });
    const forms = c.forms.filter(f => safeUrl(f.url)).map(f => ({ url: safeUrl(f.url), method: /^[A-Z]{3,10}$/.test(f.method) ? f.method : "UNKNOWN", fields: f.fields.filter(v => /^[a-z_][a-z0-9_.[\]-]{0,63}$/i.test(v)), tokenPresent: f.tokenPresent, contentType: ["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain"].includes(f.contentType) ? f.contentType : "unknown" }));
    if (forms.length) files["recon/forms.json"] = json({ ...provenance, forms });
    const javascript = c.jsUrls.map(safeUrl).filter(Boolean);
    if (javascript.length) files["recon/javascript.json"] = json({ ...provenance, javascript });
    if (c.technologies.length) files["recon/observations.json"] = json({ ...provenance, technologies: c.technologies.map(exportText) });
  }
  if (findings.length) files["findings/existing-findings.json"] = json({ source: `Target ${target.id} findings`, generatedAt: provenance.generatedAt, findings: findings.map(f => ({ id: f.id, title: exportText(f.title), severity: f.severity, vulnClass: f.vulnClass ? exportText(f.vulnClass) : null, reviewStatus: f.reviewStatus, location: f.location ? safeUrl(f.location) : null })) });
  // A final fail-closed check prevents accidental future secret-field exports.
  if (/apiKeyCipher|cookiesCipher|headerCipher|emailCipher|passwordCipher|sessionCookiesCipher|AUTH_SECRET|DATABASE_URL|REDIS_URL|CREDENTIALS_ENCRYPTION_KEY/.test(Object.values(files).join("\n"))) throw new ResearchError("Export contains forbidden secret fields");
  return files;
}

const workspacePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function workspacePath(root: string, workspaceId: string) {
  if (!isAbsolute(root) || !workspacePattern.test(workspaceId)) throw new ResearchError("Invalid workspace identity");
  return join(resolve(root), workspaceId);
}
export const newWorkspaceId = () => randomUUID();
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");
async function safeDirectory(path: string, mode: number, gid: number) {
  await mkdir(path, { recursive: true, mode });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()) throw new ResearchError("Unsafe workspace directory");
  await chown(path, info.uid, gid); await chmod(path, mode);
}
async function checkAncestors(path: string) {
  let current = resolve(path);
  while (current !== dirname(current)) {
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new ResearchError("Unsafe workspace root");
    current = dirname(current);
  }
}
export async function writeResearchWorkspace(root: string, workspaceId: string, files: Record<string, string>) {
  const final = workspacePath(root, workspaceId), temp = join(root, `.tmp-${workspaceId}`);
  const gid = Number(process.env.RESEARCH_WORKSPACE_GID ?? process.getgid?.());
  if (!Number.isSafeInteger(gid) || gid < 0) throw new ResearchError("Invalid workspace group");
  await mkdir(root, { recursive: true, mode: 0o3770 });
  await checkAncestors(root);
  await safeDirectory(root, 0o3770, gid); // sticky bit: researcher cannot rename another owner's sessions
  const exports = join(root, ".exports");
  await safeDirectory(exports, 0o700, gid);
  await mkdir(temp, { mode: 0o700 }); // exclusive; no partial workspace is visible to SSH
  const archiveTemp = join(exports, `.tmp-${workspaceId}`), archivePath = join(exports, `${workspaceId}.zip`);
  try {
    // Never overwrite a prior session, even with the same server identity.
    try { await lstat(final); throw new ResearchError("Workspace already exists"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    for (const [name, content] of Object.entries(files)) {
      if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.startsWith("/") || name.split("/").some(p => !p || p === "." || p === "..")) throw new ResearchError("Invalid bundle file");
      const writable = /^(research|evidence|scripts)\//.test(name);
      if (dirname(name) !== ".") await safeDirectory(join(temp, dirname(name)), writable ? 0o2770 : 0o2750, gid);
      const file = await open(join(temp, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, writable ? 0o660 : 0o440);
      try { await file.chown(process.getuid!(), gid); await file.chmod(writable ? 0o660 : 0o440); await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    }
    const zip = bundleZip(files), archive = await open(archiveTemp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await archive.writeFile(zip); await archive.sync(); } finally { await archive.close(); }
    await chown(temp, process.getuid!(), gid); await chmod(temp, 0o2750);
    await rename(archiveTemp, archivePath);
    await rename(temp, final); // single publication point
    return { exportSha256: digest(zip), files: Object.keys(files).sort() };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    await rm(archiveTemp, { force: true });
    throw error;
  }
}
export async function readResearchZip(root: string, workspaceId: string, expectedHash: string) {
  workspacePath(root, workspaceId);
  await checkAncestors(join(root, ".exports"));
  const archive = await open(join(root, ".exports", `${workspaceId}.zip`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await archive.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 16_100_000) throw new ResearchError("Unsafe export");
    const zip = await archive.readFile();
    if (digest(zip) !== expectedHash) throw new ResearchError("Export integrity check failed");
    return zip;
  } finally { await archive.close(); }
}
