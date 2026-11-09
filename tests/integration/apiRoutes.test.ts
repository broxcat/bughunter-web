// Light integration tests for the authorization-critical API route handlers.
//
// These run ONLY when TEST_DATABASE_URL points at a disposable Postgres; when it
// is unset the whole suite is describe.skip-ped so `npm test` stays green in CI
// with just the unit suite (no Docker needed for the default run).
//
// How to run locally:
//   # 1. start a throwaway Postgres
//   docker run --rm -d --name bh-test-pg -p 5544:5432 \
//     -e POSTGRES_PASSWORD=test -e POSTGRES_DB=bughunter_test postgres:16-alpine
//   # 2. point the tests at it and run
//   export TEST_DATABASE_URL="postgresql://postgres:test@localhost:5544/bughunter_test"
//   npm test
//   # 3. tear down
//   docker rm -f bh-test-pg
//
// The beforeAll step runs `prisma migrate deploy` against TEST_DATABASE_URL, so
// the throwaway database is schema-complete before any handler is imported.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { execSync } from "node:child_process";

const TEST_DB = process.env.TEST_DATABASE_URL;

// Prisma reads DATABASE_URL at client construction; set it BEFORE any module
// that imports @/lib/prisma is (dynamically) imported below.
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

// auth() is mocked to a fake session; scanQueue is mocked so no Redis is needed
// (the REVOKED check happens before the queue is touched anyway).
const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: authMock.auth }));
vi.mock("@/server/queue/scanQueue", () => ({
  deliverScanJob: vi.fn(async () => ({ alreadyPresent: false })),
}));
// Redis-backed rate limiter: mocked to "allowed" so the auth logic is exercised
// without Redis. (It runs BEFORE the scope check in scan-runs; its connection
// uses maxRetriesPerRequest:null, so a missing Redis would hang the command
// forever rather than fail open.) This is infra isolation, not the logic under
// test — the APPROVED/REVOKED decision below is still the real handler code.
vi.mock("@/lib/rateLimit", () => ({
  rateLimit: vi.fn(async () => ({ status: "ALLOWED", remaining: 99, resetSec: 3600 })),
}));

const d = TEST_DB ? describe : describe.skip;

// Populated in beforeAll (dynamic imports so env + mocks are in place first).
type Mod = typeof import("@/lib/prisma");
let prisma: Mod["prisma"];
let targetsPost: typeof import("@/app/api/targets/route").POST;
let scanRunsPost: typeof import("@/app/api/scan-runs/route").POST;
let reportsPost: typeof import("@/app/api/reports/route").POST;
let scopesPost: typeof import("@/app/api/scopes/route").POST;
let scopePatch: typeof import("@/app/api/scopes/[id]/route").PATCH;
let findingsPost: typeof import("@/app/api/findings/route").POST;
let findingPatch: typeof import("@/app/api/findings/[id]/route").PATCH;
let NextRequest: typeof import("next/server").NextRequest;

let userId: string;

function req(url: string, body: unknown, method = "POST") {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

d("API route authorization (integration)", () => {
  beforeAll(async () => {
    // Bring the throwaway DB up to the current schema.
    execSync("npx prisma migrate deploy", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_DB },
    });

    ({ prisma } = await import("@/lib/prisma"));
    ({ POST: targetsPost } = await import("@/app/api/targets/route"));
    ({ POST: scanRunsPost } = await import("@/app/api/scan-runs/route"));
    ({ POST: reportsPost } = await import("@/app/api/reports/route"));
    ({ POST: scopesPost } = await import("@/app/api/scopes/route"));
    ({ PATCH: scopePatch } = await import("@/app/api/scopes/[id]/route"));
    ({ POST: findingsPost } = await import("@/app/api/findings/route"));
    ({ PATCH: findingPatch } = await import("@/app/api/findings/[id]/route"));
    ({ NextRequest } = await import("next/server"));

    // Clean slate, FK-safe order.
    await prisma.reportItem.deleteMany();
    await prisma.report.deleteMany();
    await prisma.finding.deleteMany();
    await prisma.scanRun.deleteMany();
    await prisma.target.deleteMany();
    await prisma.scope.deleteMany();
    await prisma.bountyProgram.deleteMany();
    await prisma.user.deleteMany();

    const user = await prisma.user.create({
      data: { email: `q-${Date.now()}@test.local` },
    });
    userId = user.id;
    authMock.auth.mockResolvedValue({ user: { id: userId } });
  }, 60_000);

  it('resolves a hunter identity and saves append-only execution policy versions', async () => {
    const { PUT } = await import('@/app/api/settings/hunter-identity/route');
    const { PATCH } = await import('@/app/api/programs/[id]/route');
    const { loadTargetExecution } = await import('@/server/execution');
    const user = await prisma.user.create({ data: { email: 'policy-' + Date.now() + '@test.local' } });
    authMock.auth.mockResolvedValue({ user: { id: user.id } });
    try {
      const program = await prisma.bountyProgram.create({ data: { ownerId: user.id, companyName: 'Policy fixture', requiredUserAgent: '' } });
      const scope = await prisma.scope.create({ data: { userId: user.id, hostPattern: 'app.example.test', status: 'APPROVED' } });
      const target = await prisma.target.create({ data: { userId: user.id, programId: program.id, scopeId: scope.id, host: 'app.example.test', active: true } });
      await expect(loadTargetExecution(target.id, 'RECON')).rejects.toThrow(/Settings.*Hunter identity/);
      expect((await PUT(req('http://localhost/api/settings/hunter-identity', {
        userAgent: 'Hunter/1', headers: [{ name: 'X-Bug-Bounty', value: 'hunter' }],
      }, 'PUT'))).status).toBe(200);
      expect((await loadTargetExecution(target.id, 'RECON')).requiredUserAgent).toBe('Hunter/1');
      const policy = {
        automationAllowed: true, requiredUserAgent: 'Program/1', requiredHeaders: [{ name: 'X-Bug-Bounty', value: 'program' }],
        exclusions: ['https://app.example.test/admin/*'], requestsPerSecond: 2, maxConcurrency: 1, forbiddenCategories: ['BRUTE_FORCE'],
        sourceSnapshot: { url: null, rules: '', unrepresentedRules: [] },
      };
      const update = (executionPolicy: typeof policy) => PATCH(
        req('http://localhost/api/programs/' + program.id, { executionPolicy }, 'PATCH'), { params: Promise.resolve({ id: program.id }) },
      );
      expect((await update(policy)).status).toBe(200);
      expect(await loadTargetExecution(target.id, 'RECON')).toMatchObject({
        requiredUserAgent: 'Program/1', policy: { version: 1, headers: { 'x-bug-bounty': 'program' } },
      });
      expect((await update({ ...policy, automationAllowed: false })).status).toBe(200);
      await expect(loadTargetExecution(target.id, 'RECON')).rejects.toThrow(/disabled/);
      const versions = await prisma.programExecutionPolicy.findMany({ where: { programId: program.id }, orderBy: { version: 'asc' } });
      expect(versions.map(row => row.version)).toEqual([1, 2]);
      expect(versions[0].policy).toMatchObject({ automationAllowed: true });
    } finally {
      authMock.auth.mockResolvedValue({ user: { id: userId } });
    }
  });

  it("POST /api/scan-runs refuses VALIDATE without changing the database or queue", async () => {
    const { deliverScanJob } = await import("@/server/queue/scanQueue");
    const before = await prisma.scanRun.count();
    const queuedBefore = vi.mocked(deliverScanJob).mock.calls.length;
    const response = await scanRunsPost(req("http://localhost/api/scan-runs", { targetId: "legacy", type: "VALIDATE" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/not supported/);
    expect(await prisma.scanRun.count()).toBe(before);
    expect(vi.mocked(deliverScanJob).mock.calls.length).toBe(queuedBefore);
  });

  it("POST /api/targets rejects (400) when the linked Scope is not APPROVED", async () => {
    const scope = await prisma.scope.create({
      data: { userId, hostPattern: "*.pending.com", status: "PENDING" },
    });
    const res = await targetsPost(
      req("http://localhost/api/targets", { scopeId: scope.id, host: "pending.com" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/APPROVED/);
  });

  it("POST /api/scan-runs rejects when the target's Scope is REVOKED (re-verification)", async () => {
    const scope = await prisma.scope.create({
      data: { userId, hostPattern: "*.revoked.com", status: "APPROVED" },
    });
    const target = await prisma.target.create({
      data: { userId, scopeId: scope.id, host: "revoked.com" },
    });
    // Revoke AFTER the target exists: the scan-runs route must re-check.
    await prisma.scope.update({ where: { id: scope.id }, data: { status: "REVOKED" } });

    const res = await scanRunsPost(
      req("http://localhost/api/scan-runs", { targetId: target.id, type: "RECON" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not APPROVED/i);
  });

  it("POST /api/reports rejects a finding that is not confirmed", async () => {
    const scope = await prisma.scope.create({
      data: { userId, hostPattern: "*.rep.com", status: "APPROVED" },
    });
    const target = await prisma.target.create({
      data: { userId, scopeId: scope.id, host: "rep.com" },
    });
    const finding = await prisma.finding.create({
      data: { targetId: target.id, title: "unvalidated bug", gateStatus: "UNVALIDATED" },
    });

    const res = await reportsPost(
      req("http://localhost/api/reports", {
        title: "My report",
        platform: "HACKERONE",
        findingIds: [finding.id],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/confirmed/);
  });

  it("POST /api/reports accepts a PASSED finding (201)", async () => {
    const scope = await prisma.scope.create({
      data: { userId, hostPattern: "*.ok.com", status: "APPROVED" },
    });
    const target = await prisma.target.create({
      data: { userId, scopeId: scope.id, host: "ok.com" },
    });
    const finding = await prisma.finding.create({
      data: { targetId: target.id, title: "real bug", lifecycle:null, gateStatus: "PASSED", severity: "HIGH" },
    });

    const res = await reportsPost(
      req("http://localhost/api/reports", {
        title: "Valid report",
        platform: "GENERIC",
        findingIds: [finding.id],
      }),
    );
    expect(res.status).toBe(201);
  });

  it("normalizes host: 'https://ex.com/path' and 'ex.com' both store host 'ex.com'", async () => {
    const scope = await prisma.scope.create({
      data: { userId, hostPattern: "*.ex.com", status: "APPROVED" },
    });

    const r1 = await targetsPost(
      req("http://localhost/api/targets", { scopeId: scope.id, host: "https://ex.com/path" }),
    );
    expect(r1.status).toBe(201);
    const t1 = await r1.json();
    expect(t1.host).toBe("ex.com");
    expect(t1.scheme).toBe("https");

    const r2 = await targetsPost(
      req("http://localhost/api/targets", { scopeId: scope.id, host: "ex.com" }),
    );
    expect(r2.status).toBe(201);
    const t2 = await r2.json();
    expect(t2.host).toBe("ex.com");
    expect(t2.scheme).toBeNull();
  });
  it("POST /api/scopes stores the program policy but still creates the scope PENDING", async () => {
    const res = await scopesPost(
      req("http://localhost/api/scopes", {
        hostPattern: "*.yeswehack-prog.com",
        programName: "Prog",
        platform: "YESWEHACK",
        outOfScope: "staging.*, DoS",
        rulesOfEngagement: "No automated scanning above 5 req/s",
        status: "APPROVED", // must be ignored
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("PENDING");
    expect(body.platform).toBe("YESWEHACK");
    expect(body.outOfScope).toBe("staging.*, DoS");
    expect(body.contactInfo).toBeNull();
  });

  it("PATCH /api/scopes/[id] edits policy only and cannot approve or retarget a scope", async () => {
    const scope = await prisma.scope.create({
      data: { userId, hostPattern: "*.patch.com", status: "PENDING" },
    });
    const res = await scopePatch(
      req(
        `http://localhost/api/scopes/${scope.id}`,
        { safeHarbor: "Good-faith research is protected", status: "APPROVED", hostPattern: "*.evil.com" },
        "PATCH",
      ),
      { params: Promise.resolve({ id: scope.id }) },
    );
    expect(res.status).toBe(200);
    const after = await prisma.scope.findUniqueOrThrow({ where: { id: scope.id } });
    expect(after.safeHarbor).toBe("Good-faith research is protected");
    expect(after.status).toBe("PENDING");
    expect(after.hostPattern).toBe("*.patch.com");
  });

  it("POST /api/findings pre-fills the CWE from vulnClass and derives the CVSS score server-side", async () => {
    const scope = await prisma.scope.create({
      data: { userId, hostPattern: "*.cvss.com", status: "APPROVED" },
    });
    const target = await prisma.target.create({
      data: { userId, scopeId: scope.id, host: "cvss.com" },
    });
    const res = await findingsPost(
      req("http://localhost/api/findings", {
        targetId: target.id,
        title: "XSS",
        vulnClass: "XSS",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
      }),
    );
    expect(res.status).toBe(201);
    const f = await res.json();
    expect(f.cwe).toBe("CWE-79");
    expect(f.cvssScore).toBe(6.1);
    expect(f.severity).toBe("INFO"); // CVSS never changes severity
    expect(f.gateStatus).toBe("UNVALIDATED");
  });

  it("PATCH /api/findings/[id] validates input and never touches severity or gate status", async () => {
    const scope = await prisma.scope.create({
      data: { userId, hostPattern: "*.fpatch.com", status: "APPROVED" },
    });
    const target = await prisma.target.create({
      data: { userId, scopeId: scope.id, host: "fpatch.com" },
    });
    const finding = await prisma.finding.create({
      data: { targetId: target.id, title: "x", severity: "LOW", gateStatus: "UNVALIDATED" },
    });
    const patch = (body: unknown) =>
      findingPatch(req(`http://localhost/api/findings/${finding.id}`, body, "PATCH"), {
        params: Promise.resolve({ id: finding.id }),
      });

    expect((await patch({ cvssVector: "CVSS:3.1/AV:N" })).status).toBe(400);
    expect((await patch({ cwe: "79" })).status).toBe(400);

    const ok = await patch({
      cwe: "CWE-352",
      cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      impact: "Full compromise",
      severity: "CRITICAL", // ignored
      gateStatus: "PASSED", // ignored
    });
    expect(ok.status).toBe(200);
    const after = await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(after.cvssScore).toBe(9.8);
    expect(after.cwe).toBe("CWE-352");
    expect(after.severity).toBe("LOW");
    expect(after.gateStatus).toBe("UNVALIDATED");

    // null clears both vector and derived score.
    await patch({ cvssVector: null });
    const cleared = await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(cleared.cvssVector).toBeNull();
    expect(cleared.cvssScore).toBeNull();
  });

  it("POST /api/reports renders the standard skeleton with CWE, CVSS and OOB proof of concept", async () => {
    const scope = await prisma.scope.create({
      data: { userId, hostPattern: "*.skel.com", status: "APPROVED" },
    });
    const target = await prisma.target.create({
      data: { userId, scopeId: scope.id, host: "skel.com" },
    });
    const token = `tok-${Date.now()}`;
    await prisma.oobHit.create({ data: { token, method: "GET", sourceIp: "203.0.113.9" } });
    const finding = await prisma.finding.create({
      data: {
        targetId: target.id,
        title: "Blind SSRF",
        vulnClass: "SSRF",
        severity: "HIGH",
        gateStatus: "PASSED",
        lifecycle:null,
        oobToken: token,
        cwe: "CWE-918",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:N/A:N",
        cvssScore: 8.6,
      },
    });
    const res = await reportsPost(
      req("http://localhost/api/reports", {
        title: "SSRF report",
        platform: "YESWEHACK",
        findingIds: [finding.id],
      }),
    );
    expect(res.status).toBe(201);
    const { markdown } = await res.json();
    expect(markdown).toContain("YesWeHack report");
    expect(markdown).toContain("CWE: CWE-918");
    expect(markdown).toContain("CVSS 3.1 Score: 8.6 (High)");
    expect(markdown).toContain("GET from 203.0.113.9");
    expect(markdown).toContain("To complete: demonstrated business or technical impact.");
  });
  it("creates a business Target atomically with decimal rewards and active hosts", async () => {
    const { POST } = await import("@/app/api/programs/route");
    const res = await POST(req("http://localhost/api/programs", {
      companyName: "VINCI", requiredUserAgent: "VINCI-Research/1.0", rewardLow: "100.10",
      scopeHosts: ["WWW.Vinci.com.", "*.example.vinci.com"], outOfScope: ["admin.example.vinci.com"],
    }));
    expect(res.status).toBe(201);
    const p = await res.json();
    expect(p.rewardLow).toBe("100.1");
    const hosts = await prisma.target.findMany({ where: { programId: p.id }, include: { scope: true } });
    expect(hosts.map(t => t.host).sort()).toEqual(["*.example.vinci.com", "www.vinci.com"]);
    expect(hosts.every(t => t.active && t.scope.status === "APPROVED")).toBe(true);
  });
  it("creates an unconfigured target without inventing a User-Agent and rejects invalid explicit policy", async () => {
    const { POST } = await import("@/app/api/programs/route");
    const created = await POST(req("http://localhost/api/programs", { companyName: "x" }));
    expect(created.status).toBe(201);
    const program = await created.json();
    expect((await prisma.bountyProgram.findUniqueOrThrow({ where: { id: program.id } })).requiredUserAgent).toBe("");
    for (const body of [{ companyName: "x", requiredUserAgent: "" },
      { companyName: "x", requiredUserAgent: "x", rewardLow: 0.1 },
      { companyName: "x", requiredUserAgent: "x", scopeHosts: ["https://example.com/path"] }]) {
      expect((await POST(req("http://localhost/api/programs", body))).status).toBe(400);
    }
  });
  it("edits program configuration and protects ownership", async () => {
    const { PATCH, GET } = await import("@/app/api/programs/[id]/route");
    const p = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Lab", requiredUserAgent: "old" } });
    const context = { params: Promise.resolve({ id: p.id }) };
    expect((await PATCH(req("http://localhost", { companyName: "Private Lab", requiredUserAgent: "new", rewardHigh: "999.99" }, "PATCH"), context)).status).toBe(200);
    expect((await prisma.bountyProgram.findUniqueOrThrow({ where: { id: p.id } })).requiredUserAgent).toBe("new");
    authMock.auth.mockResolvedValueOnce({ user: { id: "another-user" } });
    expect((await GET(req("http://localhost", {}), context)).status).toBe(404);
    authMock.auth.mockResolvedValueOnce({ user: { id: "another-user" } });
    expect((await PATCH(req("http://localhost", { requiredUserAgent: "stolen" }, "PATCH"), context)).status).toBe(404);
    expect((await PATCH(req("http://localhost", { requiredUserAgent: "   " }, "PATCH"), context)).status).toBe(400);
    expect((await PATCH(req("http://localhost", { requiredUserAgent: "" }, "PATCH"), context)).status).toBe(200);
    expect((await prisma.bountyProgram.findUniqueOrThrow({ where: { id: p.id } })).requiredUserAgent).toBe("");
  });

  it("adds, edits and removes scope hosts while preserving all historical references", async () => {
    const { POST } = await import("@/app/api/programs/[id]/hosts/route");
    const { PATCH, DELETE } = await import("@/app/api/programs/[id]/hosts/[hostId]/route");
    const p = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Scope Lab", requiredUserAgent: "Lab/1" } });
    const params = { params: Promise.resolve({ id: p.id }) };
    const create = (host: string) => POST(req("http://localhost", { host }), params);
    const added = await create("API.Example.com.");
    expect(added.status).toBe(201);
    const h = await added.json();
    expect(h.host).toBe("api.example.com");
    expect((await create("api.example.com")).status).toBe(409);
    expect((await create("*.example.com")).status).toBe(201);
    expect((await create("https://example.com/a")).status).toBe(400);
    const run = await prisma.scanRun.create({ data: { targetId: h.id, type: "RECON" } });
    const finding = await prisma.finding.create({ data: { targetId: h.id, scanRunId: run.id, title: "history" } });
    const credential = await prisma.targetCredential.create({ data: { targetId: h.id, label: "test", headerCipher: "encrypted" } });
    const report = await prisma.report.create({ data: { targetId: h.id, userId, title: "history" } });
    const hParams = { params: Promise.resolve({ id: p.id, hostId: h.id }) };
    const edited = await PATCH(req("http://localhost", { host: "new.example.com" }, "PATCH"), hParams);
    expect(edited.status).toBe(200);
    const newHost = await edited.json();
    expect(newHost.id).not.toBe(h.id);
    expect((await prisma.target.findUniqueOrThrow({ where: { id: h.id } })).active).toBe(false);
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } })).targetId).toBe(h.id);
    expect((await prisma.targetCredential.findUniqueOrThrow({ where: { id: credential.id } })).targetId).toBe(h.id);
    expect((await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).targetId).toBe(h.id);
    expect((await DELETE(req("http://localhost", {}, "DELETE"), { params: Promise.resolve({ id: p.id, hostId: newHost.id }) })).status).toBe(200);
    expect((await prisma.target.findUniqueOrThrow({ where: { id: newHost.id } })).active).toBe(false);
    authMock.auth.mockResolvedValueOnce({ user: { id: "another-user" } });
    expect((await create("stolen.example.com")).status).toBe(404);
  });

  it("Recon accepts wildcard discovery while Research and active execution require concrete hosts", async () => {
    const { GET } = await import("@/app/api/scan-hosts/route");
    const { POST: add } = await import("@/app/api/programs/[id]/hosts/route");
    const { loadTargetExecution } = await import("@/server/execution");
    const p = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Scan Lab", requiredUserAgent: "ScanLab/1", outOfScope: ["admin.scan.example"] } });
    const context = { params: Promise.resolve({ id: p.id }) };
    const host = async (fqdn: string) => (await add(req("http://localhost", { host: fqdn }), context)).json();
    const active = await host("api.scan.example");
    const excluded = await host("admin.scan.example");
    const removed = await host("old.scan.example");
    const wildcard = await host("*.scan.example");
    await prisma.target.update({ where: { id: removed.id }, data: { active: false } });
    const programs = await (await GET()).json();
    expect(programs.find((v: { id: string }) => v.id === p.id).hosts.map((v: { id: string }) => v.id)).toEqual([wildcard.id,active.id]);
    expect((await scanRunsPost(req("http://localhost", {targetId:wildcard.id,type:"RECON"}))).status).toBe(201);
    await expect(loadTargetExecution(wildcard.id)).rejects.toThrow(/discovery rule/);
    expect((await loadTargetExecution(wildcard.id,"RECON")).programReconId).toBe(p.id);
    for (const h of [excluded, removed]) {
      expect((await scanRunsPost(req("http://localhost", { targetId: h.id, type: "RECON" }))).status).toBe(400);
      await expect(loadTargetExecution(h.id)).rejects.toThrow();
    }
    expect((await scanRunsPost(req("http://localhost", { targetId: active.id, type: "RECON", requiredUserAgent: "untrusted" }))).status).toBe(201);
    expect((await loadTargetExecution(active.id)).requiredUserAgent).toBe("ScanLab/1");
    await prisma.bountyProgram.update({ where: { id: p.id }, data: { requiredUserAgent: "ScanLab/2" } });
    expect((await loadTargetExecution(active.id)).requiredUserAgent).toBe("ScanLab/2");
    authMock.auth.mockResolvedValueOnce({ user: { id: "another-user" } });
    expect((await scanRunsPost(req("http://localhost", { targetId: active.id, type: "RECON" }))).status).toBe(404);
    expect(await prisma.target.count({ where: { programId: p.id, host: "discovered.other.example" } })).toBe(0);
    await prisma.bountyProgram.update({ where: { id: p.id }, data: { outOfScope: ["*.scan.example"] } });
    await expect(loadTargetExecution(active.id)).rejects.toThrow(/out of scope/);
  });

  it("reuses legacy identities only after explicit assignment and preserves their original authorization relation", async () => {
    const { POST } = await import("@/app/api/programs/[id]/hosts/route");
    const p = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Legacy Lab", requiredUserAgent: "Legacy/1" } });
    const scope = await prisma.scope.create({ data: { userId, hostPattern: "*.legacy.example", status: "APPROVED" } });
    const old = await prisma.target.create({ data: { userId, scopeId: scope.id, host: "old.legacy.example" } });
    const run = await prisma.scanRun.create({ data: { targetId: old.id, type: "RECON" } });
    const res = await POST(req("http://localhost", { host: old.host, legacyTargetId: old.id }), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(201);
    const host = await res.json();
    expect(host.id).toBe(old.id);
    expect(host.scopeId).toBe(scope.id);
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).targetId).toBe(old.id);
  });
  it("rejects cross-user host edits/removals and unauthenticated program reads", async () => {
    const { POST } = await import("@/app/api/programs/[id]/hosts/route");
    const { PATCH, DELETE } = await import("@/app/api/programs/[id]/hosts/[hostId]/route");
    const { GET } = await import("@/app/api/programs/route");
    const p = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Owned Lab", requiredUserAgent: "Owned/1" } });
    const h = await (await POST(req("http://localhost", { host: "owned.example.test" }), { params: Promise.resolve({ id: p.id }) })).json();
    const params = { params: Promise.resolve({ id: p.id, hostId: h.id }) };
    authMock.auth.mockResolvedValueOnce({ user: { id: "another-user" } });
    expect((await PATCH(req("http://localhost", { host: "stolen.example.test" }, "PATCH"), params)).status).toBe(404);
    authMock.auth.mockResolvedValueOnce({ user: { id: "another-user" } });
    expect((await DELETE(req("http://localhost", {}, "DELETE"), params)).status).toBe(404);
    authMock.auth.mockResolvedValueOnce(null);
    expect((await GET(new Request('http://app.example.test/api/programs'))).status).toBe(401);
    expect((await prisma.target.findUniqueOrThrow({ where: { id: h.id } })).active).toBe(true);
  });
  it("serializes concurrent duplicate additions and never rewrites historical scan User-Agents", async () => {
    const { POST } = await import("@/app/api/programs/[id]/hosts/route");
    const p = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Race Lab", requiredUserAgent: "Race/1" } });
    const add = () => POST(req("http://localhost", { host: "race.example.test" }), { params: Promise.resolve({ id: p.id }) });
    const responses = await Promise.all([add(), add()]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    const target = await prisma.target.findFirstOrThrow({ where: { programId: p.id } });
    const run = await prisma.scanRun.create({ data: { targetId: target.id, type: "RECON", status: "COMPLETED", requiredUserAgent: "Race/1" } });
    await prisma.bountyProgram.update({ where: { id: p.id }, data: { requiredUserAgent: "Race/2" } });
    const { loadTargetExecution } = await import("@/server/execution");
    expect((await loadTargetExecution(target.id)).requiredUserAgent).toBe("Race/2");
    expect((await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })).requiredUserAgent).toBe("Race/1");
  });



  it("uses existing encrypted credentials for account readiness and only edits owned metadata", async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY ??= "0".repeat(64);
    const { POST, PATCH } = await import("@/app/api/targets/[id]/credentials/route");
    const p = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Accounts", requiredUserAgent: "Accounts/1" } });
    const scope = await prisma.scope.create({ data: { userId, hostPattern: "accounts.example.test", status: "APPROVED" } });
    const t = await prisma.target.create({ data: { userId, programId: p.id, scopeId: scope.id, host: "accounts.example.test" } });
    const context = { params: Promise.resolve({ id: t.id }) };
    const add = (data: object) => POST(req("http://localhost", data), context);
    expect((await add({ label: "invalid reference", cookies: { sid: "a" }, ownedObjectUrl: "https://foreign.example/object/1" })).status).toBe(400);
    const a = await (await add({ label: "Account A", cookies: { sid: "a-secret" }, purpose: "ACCOUNT_A" })).json();
    const b = await (await add({ label: "Account B", cookies: { sid: "b-secret" }, purpose: "ACCOUNT_B", ownedObjectUrl: "https://accounts.example.test/documents/123" })).json();
    await prisma.targetCredential.update({ where: { id: a.credential.id }, data: { sessionStatus: "VALID", sessionCheckedAt: new Date(), sessionIdentityHash: "verified-test-account-a" } });
    await prisma.targetCredential.update({ where: { id: b.credential.id }, data: { sessionStatus: "VALID", sessionCheckedAt: new Date(), sessionIdentityHash: "verified-test-account-b" } });
    expect(JSON.stringify([a, b])).not.toContain("a-secret");
    expect(JSON.stringify([a, b])).not.toContain("b-secret");
    const before = await prisma.targetCredential.findUniqueOrThrow({ where: { id: b.credential.id } });
    authMock.auth.mockResolvedValueOnce({ user: { id: "another-user" } });
    expect((await PATCH(req("http://localhost", { credentialId: b.credential.id, purpose: "OTHER" }, "PATCH"), context)).status).toBe(404);
    expect((await PATCH(req("http://localhost", { credentialId: b.credential.id, purpose: "SESSION_COOKIE", cookiesCipher: "replace" }, "PATCH"), context)).status).toBe(200);
    expect((await prisma.targetCredential.findUniqueOrThrow({ where: { id: b.credential.id } })).cookiesCipher).toBe(before.cookiesCipher);
    const { POST: refresh } = await import("@/app/api/targets/[id]/credentials/refresh/route");
    expect((await refresh(req("http://localhost", { credentialId: a.credential.id }), context)).status).toBe(400);
  });


  it("reviews evidence through draft and final decisions without the retired questionnaire", async () => {
    const { POST: review } = await import("@/app/api/findings/[id]/validate/route");
    const p = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: "Evidence review fixture", requiredUserAgent: "Review/1" } });
    const scope = await prisma.scope.create({ data: { userId, hostPattern: "review.example.test", status: "APPROVED" } });
    const target = await prisma.target.create({ data: { userId, scopeId: scope.id, programId: p.id, host: "review.example.test" } });
    const finding = await prisma.finding.create({ data: { targetId: target.id, title: "Synthetic evidence", location:"https://review.example.test/api/orders", evidence: JSON.stringify({ controls: ["BASELINE_CONTROL", "INDEPENDENT_REPEAT"] }), impact: "Controlled fixture object exposed" } });
    const params = { params: Promise.resolve({ id: finding.id }) };
    const post = (body: object) => review(req("http://localhost", body), params);
    expect((await post({ answers: { q1_useNow: true } })).status).toBe(400);
    expect((await post({ status: "CONFIRMED", notes: "Local reproduction demonstrates controlled impact" })).status).toBe(400);
    expect((await post({ status: "EVIDENCE_REVIEW" })).status).toBe(200);
    expect((await post({ status: "CONFIRMED", notes: "Local reproduction compares baseline, probe and control on the owned fixture." })).status).toBe(200);
    const saved = await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(saved.reviewStatus).toBe("CONFIRMED"); expect(saved.gateAnswers).toBeNull();
    expect(saved.reviewEvidence).toMatchObject({ scope: "IN_SCOPE", control: ["BASELINE_CONTROL", "INDEPENDENT_REPEAT"] });
    expect((await reportsPost(req('http://localhost',{title:'Reviewed but not validated',platform:'GENERIC',findingIds:[finding.id]}))).status).toBe(400);
    const session=await(await import('@/server/research/sessions')).createResearchSession(userId,target.id);
    await(await import('@/server/evidenceVault')).createEvidence(userId,target.id,{kind:'HTTP_REQUEST_RESPONSE',sessionId:session.id,description:'Explicit local proof',observedAt:new Date().toISOString(),http:{method:'GET',url:'https://review.example.test/api/orders',statusCode:200},link:{entity:'finding',id:finding.id,role:'SUPPORTS'}});
    const {changeFindingLifecycle}=await import('@/server/findingLifecycle');for(const [expectedRevision,state]of ['VALIDATING','VALIDATED'].entries())await changeFindingLifecycle(userId,finding.id,{eventKey:crypto.randomUUID(),expectedRevision,state,reason:'Human reviewed the reproduction, impact and negative control',...(state==='VALIDATED'?{validation:{reproduced:true,impactDemonstrated:true,scopeRespected:true,negativeControl:'PERFORMED',conclusion:'Reproduced in authorized scope with impact and negative control'}}:{})});
    expect((await reportsPost(req("http://localhost", { title: "Evidence reviewed report", platform: "GENERIC", findingIds: [finding.id] }))).status).toBe(201);
    expect((await post({ status: "EVIDENCE_REVIEW" })).status).toBe(200);
    expect((await post({ status: "INCONCLUSIVE", notes: "A later local control could not reproduce the observation." })).status).toBe(200);
    expect((await reportsPost(req("http://localhost", { title: "Uncertain result", platform: "GENERIC", findingIds: [finding.id] }))).status).toBe(400);
    authMock.auth.mockResolvedValueOnce({ user: { id: "another-user" } });
    expect((await post({ status: "EVIDENCE_REVIEW" })).status).toBe(404);
  });

});
