import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
const url = process.env.TEST_MIGRATION_DATABASE_URL;
assert(url, "TEST_MIGRATION_DATABASE_URL must point at an EMPTY disposable PostgreSQL database");
const client = new PrismaClient({ datasourceUrl: url });
try {
  const [tables] = await client.$queryRaw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`;
  assert.equal(tables.count, 0, "Refusing to use a nonempty database");
  const temp = await mkdtemp(join(tmpdir(), "bughunter-upgrade-"));
  const migration = "20261026090000_bounty_program_scope";
  const schema = resolve("prisma/schema.prisma");
  await writeFile(join(temp, "schema.prisma"), await readFile(schema));
  await mkdir(join(temp, "migrations"));
  for (const entry of await readdir("prisma/migrations")) {
    if (entry !== migration) await cp(join("prisma/migrations", entry), join(temp, "migrations", entry), { recursive: true });
  }
  const migrate = path => execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", path], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  migrate(join(temp, "schema.prisma"));
  // Seed the pre-upgrade schema through SQL so the new client does not expect
  // columns that have not been added yet. These values are disposable fixtures.
  await client.$executeRaw`INSERT INTO "User" (id, email, "updatedAt") VALUES ('upgrade-user', 'upgrade@example.test', now())`;
  await client.$executeRaw`INSERT INTO "Scope" (id, "userId", "hostPattern", status, "updatedAt") VALUES ('upgrade-scope', 'upgrade-user', '*.example.test', 'APPROVED', now())`;
  await client.$executeRaw`INSERT INTO "Target" (id, "userId", "scopeId", host, "updatedAt") VALUES ('upgrade-host', 'upgrade-user', 'upgrade-scope', 'api.example.test', now())`;
  await client.$executeRaw`INSERT INTO "ScanRun" (id, "targetId", type, status) VALUES ('upgrade-run', 'upgrade-host', 'RECON', 'COMPLETED')`;
  await client.$executeRaw`INSERT INTO "Finding" (id, "targetId", "scanRunId", title, "updatedAt") VALUES ('upgrade-finding', 'upgrade-host', 'upgrade-run', 'Historical finding', now())`;
  await client.$executeRaw`INSERT INTO "TargetCredential" (id, "targetId", label, "headerCipher") VALUES ('upgrade-credential', 'upgrade-host', 'Historical credential', 'fixture-cipher')`;
  await client.$executeRaw`INSERT INTO "Report" (id, "userId", "targetId", title, "updatedAt") VALUES ('upgrade-report', 'upgrade-user', 'upgrade-host', 'Historical report', now())`;
  await client.$executeRaw`INSERT INTO "ReportItem" (id, "reportId", "findingId") VALUES ('upgrade-item', 'upgrade-report', 'upgrade-finding')`;
  migrate(schema);
  const host = await client.target.findUniqueOrThrow({ where: { id: "upgrade-host" }, include: { scanRuns: true, findings: true, reports: { include: { items: true } }, credentials: true, scope: true } });
  assert.equal(host.programId, null);
  assert.equal(host.active, true);
  assert.equal(host.host, "api.example.test");
  assert.equal(host.scope.status, "APPROVED");
  assert.equal(host.scanRuns[0].id, "upgrade-run");
  assert.equal(host.scanRuns[0].requiredUserAgent, null);
  assert.equal(host.findings[0].scanRunId, "upgrade-run");
  assert.equal(host.credentials[0].headerCipher, "fixture-cipher");
  assert.equal(host.reports[0].items[0].findingId, "upgrade-finding");
  await assert.rejects(client.bountyProgram.create({ data: { ownerId: "upgrade-user", companyName: "Invalid", requiredUserAgent: "" } }));
  const p = await client.bountyProgram.create({ data: { ownerId: "upgrade-user", companyName: "Rewards", requiredUserAgent: "Program/1", rewardCritical: "9999999999999999.99" } });
  assert.equal(p.rewardCritical.toString(), "9999999999999999.99");
  console.log("Additive upgrade passed: scan/finding/report/item/credential identities preserved, legacy UA remains unknown, DB rejects empty UA, decimal money stays exact.");
} finally { await client.$disconnect(); }
