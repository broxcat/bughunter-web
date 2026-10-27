import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, lstat, symlink, unlink, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { assertResearchTarget, createResearchBundle, workspacePath, writeResearchWorkspace, readResearchZip, newWorkspaceId, exportText } from "@/server/research/workspace";
import { bundleZip } from "@/server/research/zip";
import { researchTarget, researchRecon, researchSession } from "../fixtures/research";

function unzip(buffer: Buffer): Record<string, string> {
  return JSON.parse(execFileSync("python3", ["-c", "import io,sys,json,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))"], { input: buffer }).toString());
}
const bundle = () => createResearchBundle(researchTarget(), researchRecon(), [{ id: "f", title: "Existing observation", severity: "INFO", vulnClass: null, reviewStatus: "CANDIDATE", location: "https://app.example.test/profile" }], researchSession);
describe("authorized, evidence-grounded export", () => {
  it.each(["foreign owner", "foreign program", "foreign scope", "revoked", "inactive", "wildcard", "excluded", "scope mismatch", "text exclusion", "missing UA"])("refuses %s", reason => {
    const t = researchTarget();
    if (reason === "foreign owner") t.userId = "other";
    if (reason === "foreign program") t.program!.ownerId = "other";
    if (reason === "foreign scope") t.scope.userId = "other";
    if (reason === "revoked") t.scope.status = "REVOKED";
    if (reason === "inactive") t.active = false;
    if (reason === "wildcard") t.host = "*.example.test";
    if (reason === "excluded") t.program!.outOfScope = ["*.example.test"];
    if (reason === "scope mismatch") t.scope.hostPattern = "other.example.test";
    if (reason === "text exclusion") t.scope.outOfScope = "Do not test app.example.test";
    if (reason === "missing UA") t.program!.requiredUserAgent = "";
    expect(() => assertResearchTarget(t, "owner")).toThrow();
  });
  it("includes only real Recon observations with source references and explicit scope", () => {
    const files = bundle();
    expect(files["scope.md"]).toContain("- app.example.test");
    expect(files["scope.md"]).toContain("admin.example.test");
    expect(files["scope.md"]).toContain("Research-Test/1");
    expect(files["AGENTS.md"]).toContain("falsification condition");
    expect(files["AGENTS.md"]).toContain("Do NOT execute a generic vulnerability checklist");
    const endpoints = JSON.parse(files["recon/endpoints.json"]);
    expect(endpoints.source).toBe("ScanRun recon");
    expect(endpoints.endpoints.some((e: { url: string }) => e.url.includes("/search"))).toBe(true);
    expect(Object.values(files).join("\n")).not.toContain("foreign.example.test");
    expect(JSON.parse(files["target.json"]).authenticatedContexts[0]).toMatchObject({ available: true, credentialsExported: false });
  });
  it("omits observation files when no data exists and marks missing Recon explicitly", () => {
    const files = createResearchBundle(researchTarget(), null, [], researchSession);
    expect(Object.keys(files).some(k => k.startsWith("recon/") || k.startsWith("findings/"))).toBe(false);
    expect(files["README.md"]).toContain("No Recon evidence");
  });
  it("does not export raw secrets, unknown Prisma fields or request bodies, in files or ZIP", () => {
    const t = researchTarget();
    Object.assign(t, { cookiesCipher: "cipher-sentinel", apiKeyCipher: "ai-cipher-sentinel", password: "password-sentinel", bearer: "bearer-sentinel", AUTH_SECRET: "auth-sentinel", DATABASE_URL: "database-sentinel" });
    Object.assign(t.credentials[0], { cookies: "cookie-sentinel", headerCipher: "header-sentinel", passwordCipher: "pw-cipher-sentinel" });
    t.scope.rulesOfEngagement += "\nCookie: sensitive-cookie\nAuthorization: Bearer sensitive-bearer\npassword=cleartext-password\napiKeyCipher=arbitrary-ciphertext\nAPI_KEY=sk-fixture-private";
    const files = createResearchBundle(t, researchRecon(), [], researchSession);
    const zipFiles = unzip(bundleZip(files));
    for (const source of [JSON.stringify(files), JSON.stringify(zipFiles)]) {
      for (const secret of ["cipher-sentinel", "ai-cipher-sentinel", "password-sentinel", "bearer-sentinel", "auth-sentinel", "database-sentinel", "cookie-sentinel", "header-sentinel", "pw-cipher-sentinel", "sensitive-cookie", "sensitive-bearer", "cleartext-password", "arbitrary-ciphertext", "sk-fixture-private", "private-value", "csrf-fixture-secret", "cookie-fixture-secret", "raw-private-body"]) expect(source).not.toContain(secret);
      expect(source).not.toMatch(/apiKeyCipher|cookiesCipher|headerCipher|emailCipher|passwordCipher|sessionCookiesCipher|AUTH_SECRET|DATABASE_URL|REDIS_URL|CREDENTIALS_ENCRYPTION_KEY/);
    }
  });
  it("redacts secret-bearing URLs and bearer/API token text", () => {
    const text = exportText("https://user:password@app.example.test/session/secret-value?key=private-query\nBearer private-bearer\nAPI_KEY=sk-private-key");
    expect(text).not.toMatch(/password|secret-value|private-query|private-bearer|sk-private-key/);
  });
  it("creates an interoperable reproducible ZIP containing exactly the bundle", () => {
    const files = bundle(), zip = bundleZip(files);
    expect(bundleZip(files)).toEqual(zip);
    expect(unzip(zip)).toEqual(Object.fromEntries(Object.entries(files).map(([name, value]) => [`bughunter-research/${name}`, value])));
  });
});
describe("persistent workspace and immutable download", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "bughunter-research-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it.each(["../escape", "/tmp/escape", "%2e%2e%2fescape", "..%252fescape", "id/../other", "", "a"])("rejects client-shaped path %s", id => {
    expect(() => workspacePath(root, id)).toThrow();
  });
  it("publishes all files atomically and sets read-only inputs / group-writable research", async () => {
    const id = newWorkspaceId(), files = bundle();
    let done = false;
    const creation = writeResearchWorkspace(root, id, files).then(v => { done = true; return v; });
    while (!done) {
      const visible = (await readdir(root)).filter(name => !name.startsWith("."));
      if (visible.includes(id)) {
        for (const name of Object.keys(files)) expect(await readFile(join(root, id, name), "utf8")).toBe(files[name]);
      }
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    const result = await creation;
    expect((await readdir(root)).some(name => name.startsWith(".tmp-"))).toBe(false);
    expect((await lstat(join(root, id, "scope.md"))).mode & 0o777).toBe(0o440);
    expect((await lstat(join(root, id, "research/notes.md"))).mode & 0o777).toBe(0o660);
    expect((await lstat(root)).mode & 0o1000).toBe(0o1000);
    expect(unzip(await readResearchZip(root, id, result.exportSha256))).toHaveProperty("bughunter-research/AGENTS.md");
  });
  it("two concurrent creations have unique IDs and preserve an older session", async () => {
    const old = newWorkspaceId(); await writeResearchWorkspace(root, old, bundle());
    const before = await readFile(join(root, old, "scope.md"));
    const a = newWorkspaceId(), b = newWorkspaceId(); expect(a).not.toBe(b);
    await Promise.all([writeResearchWorkspace(root, a, bundle()), writeResearchWorkspace(root, b, bundle())]);
    expect(await readFile(join(root, old, "scope.md"))).toEqual(before);
    await expect(writeResearchWorkspace(root, old, { "scope.md": "overwrite" })).rejects.toThrow();
    expect(await readFile(join(root, old, "scope.md"))).toEqual(before);
  });
  it("does not follow workspace research symlinks or include subsequent secrets in downloads", async () => {
    const id = newWorkspaceId(), files = bundle(), saved = await writeResearchWorkspace(root, id, files);
    await unlink(join(root, id, "research/notes.md"));
    await symlink("/etc/passwd", join(root, id, "research/notes.md"));
    await writeFile(join(root, id, "research/.env"), "NEW_SECRET=private-after-export");
    const zip = await readResearchZip(root, id, saved.exportSha256);
    expect(unzip(zip)["bughunter-research/research/notes.md"]).toBe(files["research/notes.md"]);
    expect(zip.toString()).not.toContain("private-after-export");
  });
  it("refuses symlink roots and symlink export directories", async () => {
    const real = join(root, "real"), link = join(root, "link"); await mkdir(real); await symlink(real, link);
    await expect(writeResearchWorkspace(link, newWorkspaceId(), bundle())).rejects.toThrow("Unsafe");
    await symlink(real, join(root, ".exports"));
    await expect(writeResearchWorkspace(root, newWorkspaceId(), bundle())).rejects.toThrow("Unsafe");
  });
  it("refuses replaced/symlinked export archives", async () => {
    const id = newWorkspaceId(), saved = await writeResearchWorkspace(root, id, bundle());
    const path = join(root, ".exports", `${id}.zip`);
    await writeFile(path, "tampered");
    await expect(readResearchZip(root, id, saved.exportSha256)).rejects.toThrow("integrity");
    await unlink(path); await symlink("/etc/passwd", path);
    await expect(readResearchZip(root, id, saved.exportSha256)).rejects.toThrow();
  });
  it("rejects bundle traversal before writing outside its temporary directory", async () => {
    await expect(writeResearchWorkspace(root, newWorkspaceId(), { "../escaped": "invalid" })).rejects.toThrow();
    expect(await readdir(root)).not.toContain("escaped");
  });
});
