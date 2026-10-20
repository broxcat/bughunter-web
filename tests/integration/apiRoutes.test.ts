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
  scanQueue: { add: vi.fn(async () => ({ id: "job-test-1" })) },
}));
// Redis-backed rate limiter: mocked to "allowed" so the auth logic is exercised
// without Redis. (It runs BEFORE the scope check in scan-runs; its connection
// uses maxRetriesPerRequest:null, so a missing Redis would hang the command
// forever rather than fail open.) This is infra isolation, not the logic under
// test — the APPROVED/REVOKED decision below is still the real handler code.
vi.mock("@/lib/rateLimit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, resetSec: 3600 })),
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
    await prisma.user.deleteMany();

    const user = await prisma.user.create({
      data: { email: `q-${Date.now()}@test.local` },
    });
    userId = user.id;
    authMock.auth.mockResolvedValue({ user: { id: userId } });
  }, 60_000);

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

  it("POST /api/reports rejects a finding whose gateStatus !== PASSED", async () => {
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
    expect(body.error).toMatch(/PASSED/);
  });

  it("POST /api/reports accepts a PASSED finding (201)", async () => {
    const scope = await prisma.scope.create({
      data: { userId, hostPattern: "*.ok.com", status: "APPROVED" },
    });
    const target = await prisma.target.create({
      data: { userId, scopeId: scope.id, host: "ok.com" },
    });
    const finding = await prisma.finding.create({
      data: { targetId: target.id, title: "real bug", gateStatus: "PASSED", severity: "HIGH" },
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
    expect(markdown).toContain("YesWeHack Report");
    expect(markdown).toContain("CWE: CWE-918");
    expect(markdown).toContain("CVSS 3.1 Score: 8.6 (High)");
    expect(markdown).toContain("GET from 203.0.113.9");
    expect(markdown).toContain("À compléter : impact business/technique démontré");
  });
});
