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
    if (entry < migration || entry === "migration_lock.toml") await cp(join("prisma/migrations", entry), join(temp, "migrations", entry), { recursive: true });
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
  await client.$executeRaw`INSERT INTO "Finding" (id, "targetId", title, "gateStatus", "updatedAt") VALUES ('upgrade-passed', 'upgrade-host', 'Previously accepted', 'PASSED', now()), ('upgrade-killed', 'upgrade-host', 'Previously rejected', 'KILLED', now())`;
  for (const status of ["QUEUED", "RUNNING", "FAILED", "CANCELLED"]) {
    await client.$executeRaw`INSERT INTO "ScanRun" (id, "targetId", type, status) VALUES (${`upgrade-${status}`}, 'upgrade-host', 'RECON', ${status}::"ScanStatus")`;
  }
  await client.$executeRaw`INSERT INTO "ScanRun" (id, "targetId", type, status) VALUES ('upgrade-hunt', 'upgrade-host', 'HUNT', 'COMPLETED')`;
  const historicalRuns = await client.$queryRaw`SELECT id, status, error, "createdAt", "startedAt", "finishedAt" FROM "ScanRun" ORDER BY id`;
  // Upgrade first to the actual pre-Research schema and seed old Hunt JSON.
  for (const entry of await readdir("prisma/migrations")) {
    if (entry < "20261027170000_research_sessions" && entry >= migration) await cp(join("prisma/migrations", entry), join(temp, "migrations", entry), { recursive: true });
  }
  migrate(join(temp, "schema.prisma"));
  const huntReport = { version: 1, archivedEvidence: "Synthetic historical observation" };
  const huntSnapshot = { version: 1, selectedFamilies: ["xss"] };
  await client.scanRun.update({ where: { id: "upgrade-hunt" }, data: { huntReport, huntSnapshot, approvedHuntTechniques: ["legacy-approved-technique"] }, select: { id: true } });
  // Seed an existing Phase 1 session before adding the hypothesis registry.
  await cp(join("prisma/migrations", "20261027170000_research_sessions"), join(temp, "migrations", "20261027170000_research_sessions"), { recursive: true });
  migrate(join(temp, "schema.prisma"));
  await client.$executeRaw`INSERT INTO "ResearchSession" (id, "userId", "targetId", "workspaceId", status, "targetHost", "programName", "scopeMarkdown", files, "exportSha256", "updatedAt") VALUES ('upgrade-research', 'upgrade-user', 'upgrade-host', '81b770fc-8937-48f4-82fc-30dbf4984cdf', 'READY', 'api.example.test', 'Existing research', 'Original scope snapshot', ARRAY['scope.md','research/hypotheses.md'], 'initial-export-hash', now())`;
  const originalSession = await client.$queryRaw`SELECT id, "workspaceId", status, "scopeMarkdown", files, "exportSha256", "createdAt", "updatedAt" FROM "ResearchSession"`;
  await cp(join("prisma/migrations", "20261027190000_research_hypothesis_registry"), join(temp, "migrations", "20261027190000_research_hypothesis_registry"), { recursive: true });
  migrate(join(temp, "schema.prisma"));
  await client.$executeRaw`INSERT INTO "ResearchHypothesis" (id, "sessionId", "externalId", title, status, hypothesis, "evidenceFor", "evidenceAgainst", "nextTest", "expectedSignal", "falsificationCondition", "contentSha256", "updatedAt") VALUES ('upgrade-hypothesis', 'upgrade-research', 'H-001', 'Historical Research claim', 'CONFIRMED', 'Original unreviewed hypothesis', '[]'::jsonb, '[]'::jsonb, 'Original next test', 'Original signal', 'Original falsification', 'original-content-hash', now())`;
  await client.$executeRaw`INSERT INTO "ResearchHypothesisRevision" (id, "hypothesisId", revision, snapshot) VALUES ('upgrade-revision', 'upgrade-hypothesis', 1, '{"status":"CONFIRMED","legacy":true}'::jsonb)`;
  const originalHypotheses = await client.$queryRaw`SELECT id, status, hypothesis, "contentSha256", "createdAt", "updatedAt" FROM "ResearchHypothesis"`;
  // Also exercise a real pre-asset program with scope, host and Recon already present.
  for (const entry of await readdir('prisma/migrations')) if (entry >= '20261027190000_research_hypothesis_registry' && entry < '20261102220000_scope_assets') await cp(join('prisma/migrations', entry), join(temp, 'migrations', entry), { recursive: true });
  migrate(join(temp, 'schema.prisma'));
  await client.$executeRaw`INSERT INTO "BountyProgram" (id,"ownerId","companyName","requiredUserAgent","scopeRules","updatedAt") VALUES ('preasset-program','upgrade-user','Pre Asset fixture','Upgrade/1',ARRAY['*.example.test','api.example.test'],now())`;
  await client.$executeRaw`INSERT INTO "Target" (id,"userId","scopeId","programId",host,"updatedAt") VALUES ('preasset-host','upgrade-user','upgrade-scope','preasset-program','api.example.test',now())`;
  await client.$executeRaw`INSERT INTO "ScanRun" (id,"targetId",type,status,"reconCorpus") VALUES ('preasset-scan','preasset-host','RECON','COMPLETED','{"version":1,"source":"legacy untouched"}'::jsonb)`;
  const preasset = await client.$queryRaw`SELECT id,status,"createdAt","reconCorpus" FROM "ScanRun" WHERE id='preasset-scan'`;
  migrate(schema);
  assert.deepEqual(await client.$queryRaw`SELECT id,status,"createdAt","reconCorpus" FROM "ScanRun" WHERE id='preasset-scan'`, preasset);
  const assets = await client.scopeAsset.findMany({where:{programId:'preasset-program'},orderBy:{normalizedValue:'asc'},include:{executionTarget:true}});
  assert.equal(assets.length,2); assert(assets.every(a=>a.assetValue==='MEDIUM'&&a.typeSource==='BACKFILL'));
  assert.equal(assets.find(a=>a.normalizedValue==='api.example.test').executionTarget.id,'preasset-host');
  assert.equal(assets.find(a=>a.normalizedValue==='api.example.test').type,'API');
  assert.equal((await client.scanRun.findUniqueOrThrow({where:{id:'preasset-scan'}})).scopeAssetSnapshot,null);
  assert.equal(await client.reconPipelineStep.count(),0,'Do not invent historical step execution');
  assert.deepEqual(await client.$queryRaw`SELECT id, status, hypothesis, "contentSha256", "createdAt", "updatedAt" FROM "ResearchHypothesis"`, originalHypotheses);
  assert.equal((await client.researchHypothesis.findUniqueOrThrow({ where: { id: "upgrade-hypothesis" } })).researchData, null);
  assert.equal(await client.researchFindingPromotion.count(), 0, "Never invent historical human promotions");

  assert.deepEqual(await client.$queryRaw`SELECT id, "workspaceId", status, "scopeMarkdown", files, "exportSha256", "createdAt", "updatedAt" FROM "ResearchSession"`, originalSession);
  assert.deepEqual(await client.$queryRaw`SELECT "consoleTargetId" FROM "ResearchSession"`, [{consoleTargetId:null}]);
  const research = await client.researchSession.findUniqueOrThrow({ where: { id: "upgrade-research" } });
  assert.equal(research.hypothesesSyncedAt, null); assert.equal(research.hypothesesSourceSha256, null);
  assert.equal(research.authorizationSnapshot, null);
  assert.equal(research.provider, "codex", "Historical Research sessions must default to Codex without a history migration");
  assert.equal(await client.researchHypothesis.count(), 1); assert.equal(await client.researchHypothesisRevision.count(), 1);
  const indexes = await client.$queryRaw`SELECT indexname FROM pg_indexes WHERE tablename IN ('ResearchHypothesis', 'ResearchHypothesisRevision')`;
  assert(indexes.some(i => i.indexname === 'ResearchHypothesis_sessionId_status_idx'));
  assert(indexes.some(i => i.indexname === 'ResearchHypothesis_sessionId_externalId_key'));
  assert(indexes.some(i => i.indexname === 'ResearchHypothesisRevision_hypothesisId_revision_key'));
  const hunt = await client.scanRun.findUniqueOrThrow({ where: { id: "upgrade-hunt" } });
  assert.equal(hunt.type, "HUNT"); assert.equal(hunt.status, "COMPLETED");
  assert.deepEqual(hunt.huntReport, huntReport); assert.deepEqual(hunt.huntSnapshot, huntSnapshot);
  assert.deepEqual(hunt.approvedHuntTechniques, ["legacy-approved-technique"]);
  assert.equal(await client.researchSession.count(), 1, "Keep only the existing Phase 1 session; never backfill from scans");
  assert.deepEqual(await client.$queryRaw`SELECT id, status, error, "createdAt", "startedAt", "finishedAt" FROM "ScanRun" WHERE "targetId"='upgrade-host' ORDER BY id`, historicalRuns);
  assert.equal(await client.scanExecutionAttempt.count(), 0, "Do not invent historical execution attempts");
  assert((await client.scanRun.findMany()).every(run => run.cancelRequestedAt === null));
  assert.equal(await client.scanJobOutbox.count(), 0, "Do not invent historical publication intents");
  assert.equal(await client.scanRequestKey.count(), 0, "Do not invent historical idempotency keys");
  const outcomes = await client.scanRun.findMany({ select: { outcome: true } });
  assert(outcomes.every(run => run.outcome === null), "Migration must not infer outcomes for existing scans");
  const host = await client.target.findUniqueOrThrow({ where: { id: "upgrade-host" }, include: { scanRuns: true, findings: true, reports: { include: { items: true } }, credentials: true, scope: true } });
  assert.equal(host.programId, null);
  assert.equal(host.active, true);
  assert.equal(host.host, "api.example.test");
  assert.equal(host.scope.status, "APPROVED");
  const historicalRun = host.scanRuns.find(run => run.id === "upgrade-run");
  assert(historicalRun);
  assert.equal(historicalRun.id, "upgrade-run");
  assert.equal(historicalRun.requiredUserAgent, null);
  assert.equal(historicalRun.status, "COMPLETED");
  assert.equal(historicalRun.outcome, null);
  assert.equal(historicalRun.huntSnapshot, null);
  assert.equal(historicalRun.huntReport, null);
  assert.equal(historicalRun.reconCorpus, null);
  assert.deepEqual(historicalRun.approvedHuntTechniques, []);
  const originalFinding = host.findings.find(f => f.id === "upgrade-finding");
  assert.equal(originalFinding.huntMetadata, null);
  assert.equal(originalFinding.reviewStatus, "CANDIDATE");
  assert.equal(host.findings.find(f => f.id === "upgrade-passed").reviewStatus, "CONFIRMED");
  assert.equal(host.findings.find(f => f.id === "upgrade-killed").reviewStatus, "REJECTED");
  assert.equal(host.credentials[0].sessionStatus, "UNKNOWN");
  assert.equal(host.credentials[0].sessionCheckedAt, null);
  assert.equal(host.credentials[0].purpose, "OTHER");
  assert.equal(host.credentials[0].ownedObjectUrl, null);
  assert.equal(originalFinding.scanRunId, "upgrade-run");
  assert.equal(host.credentials[0].headerCipher, "fixture-cipher");
  assert.equal(host.reports[0].items[0].findingId, "upgrade-finding");
  await assert.rejects(client.bountyProgram.create({ data: { ownerId: "upgrade-user", companyName: "Invalid", requiredUserAgent: "" } }));
  const p = await client.bountyProgram.create({ data: { ownerId: "upgrade-user", companyName: "Rewards", requiredUserAgent: "Program/1", rewardCritical: "9999999999999999.99" } });
  assert.equal(p.rewardCritical.toString(), "9999999999999999.99");
  console.log("Additive upgrade passed: scan/finding/report/item/credential identities preserved, legacy UA remains unknown, Phase 1 ResearchSession unchanged, legacy hypothesis/session/revision preserved, nullable proof/authorization and no promotion backfill, DB rejects empty UA, decimal money stays exact.");
} finally { await client.$disconnect(); }
