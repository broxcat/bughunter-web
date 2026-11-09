import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { encryptSecret, decryptSecret } from '../../src/lib/crypto.ts';
import { modernResearchUpgrade } from './modernResearchUpgrade.mjs';
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
  // Upgrade through the exact deployed Scope Assets schema before this mission.
  await cp(join('prisma/migrations','20261102220000_scope_assets'),join(temp,'migrations','20261102220000_scope_assets'),{recursive:true});
  migrate(join(temp,'schema.prisma'));
  await client.$executeRaw`UPDATE "ScopeAsset" SET "assetValue"='CRITICAL', type='API', "typeSource"='USER' WHERE "programId"='preasset-program' AND "normalizedValue"='api.example.test'`;
  const assetBefore=await client.$queryRaw`SELECT id,"originalValue","normalizedValue",format,type,"assetValue","typeSource","createdAt","updatedAt" FROM "ScopeAsset" ORDER BY id`;
  // Exercise the exact pre-default-provider schema and its Ollama-only history.
  for (const entry of await readdir('prisma/migrations')) if (entry > '20261102220000_scope_assets' && entry < '20261104100000_default_ai_provider') await cp(join('prisma/migrations', entry), join(temp, 'migrations', entry), { recursive: true });
  migrate(join(temp,'schema.prisma'));
  for(const [index,prompt] of ['recon-summary/1','recon-report/2','recon-report/3'].entries())await client.$executeRaw`INSERT INTO "ReconSummary" (id,"programId","scanRunId",model,endpoint,"promptVersion","sourceFingerprint",input,status) VALUES (${`old-summary-${index}`},'preasset-program','preasset-scan','historical-model','http://ollama.invalid',${prompt},'historic-fingerprint','{}'::jsonb,'FAILED')`;
  const priorSummaries=await client.$queryRaw`SELECT id,model,endpoint,"promptVersion","sourceFingerprint",input,status,"createdAt" FROM "ReconSummary" ORDER BY id`;
  await client.$executeRaw`INSERT INTO "AiProviderConfig" (id,"userId",provider,model,"apiKeyCipher","isActive","updatedAt") VALUES ('older-ai','upgrade-user','OLLAMA','old-local','fixture-cipher',true,'2026-01-01'),('newer-ai','upgrade-user','OPENROUTER','selected-router','fixture-cipher',true,'2026-01-02')`;
  // Exact deployed schema before Assessment: all previously available data exists.
  await cp(join('prisma/migrations', '20261104100000_default_ai_provider'), join(temp, 'migrations', '20261104100000_default_ai_provider'), { recursive: true });
  migrate(join(temp, 'schema.prisma'));
  await client.$executeRaw`INSERT INTO "TargetReconRun" (id,"programId",status,outcome,"scopeMarkdown") VALUES ('preassessment-parent','preasset-program','COMPLETED','SUCCESS','Historical factual scope')`;
  const beforeAssessment = {
    programs: await client.$queryRaw`SELECT id,"ownerId","scopeRules","outOfScope","createdAt","updatedAt" FROM "BountyProgram" ORDER BY id`,
    parents: await client.$queryRaw`SELECT id,"programId",status,outcome,"scopeMarkdown","createdAt" FROM "TargetReconRun" ORDER BY id`,
    research: await client.$queryRaw`SELECT id,"authorizationSnapshot","scopeMarkdown",files,"updatedAt" FROM "ResearchSession" ORDER BY id`,
    findings: await client.$queryRaw`SELECT id,"targetId","scanRunId",title,"updatedAt" FROM "Finding" ORDER BY id`,
  };
  // Exercise the exact pre-authenticated-Recon schema and a real AES-GCM
  // historical session. Migration must neither invalidate nor opt it in.
  await cp(join('prisma/migrations', '20261104150000_assessment_modes'), join(temp, 'migrations', '20261104150000_assessment_modes'), { recursive: true });
  migrate(join(temp, 'schema.prisma'));
  await client.$executeRaw`UPDATE "ResearchSession" SET "authorizationSnapshot"=coalesce("authorizationSnapshot",'{}'::jsonb)||'{"assessmentMode":"WHITE_BOX","authorizedSources":[{"locator":"https://internal-admin.example.local/repo"}]}'::jsonb WHERE id='upgrade-research'`;
  beforeAssessment.research=await client.$queryRaw`SELECT id,"authorizationSnapshot","scopeMarkdown",files,"updatedAt" FROM "ResearchSession" ORDER BY id`;
  process.env.CREDENTIALS_ENCRYPTION_KEY = 'ac'.repeat(32);
  const legacySession = encryptSecret(JSON.stringify({ session: 'UPGRADE_SESSION_FIXTURE' }));
  await client.$executeRaw`INSERT INTO "TargetCredential" (id,"targetId",label,mode,purpose,"sessionStatus","sessionCheckedAt","sessionExpiresAt","cookiesCipher") VALUES ('preauth-credential','preasset-host','Existing account','COOKIES','ACCOUNT_A','VALID',now(),now()+interval '10 minutes',${legacySession})`;
  const beforeAuthentication = await client.$queryRaw`SELECT id,"targetId",label,mode,purpose,"sessionStatus","sessionCheckedAt","sessionExpiresAt","cookiesCipher","headerCipher","emailCipher","passwordCipher","sessionCookiesCipher","createdAt" FROM "TargetCredential" ORDER BY id`;
  await cp(join('prisma/migrations','20261104170000_authenticated_surface'),join(temp,'migrations','20261104170000_authenticated_surface'),{recursive:true});
  migrate(join(temp,'schema.prisma'));
  await client.$executeRaw`INSERT INTO "ScanRun" (id,"targetId","scopeAssetId",type,status,outcome,"assessmentModeSnapshot","authenticatedContextsSnapshot") SELECT 'preplan-auth-scan','preasset-host',id,'RECON'::"ScanType",'COMPLETED'::"ScanStatus",'SUCCESS'::"ScanOutcome",'WHITE_BOX'::"AssessmentMode",'{"version":1,"anonymous":{"contextKey":"ANONYMOUS","mode":"ANONYMOUS"},"contextLimit":4,"contexts":[]}'::jsonb FROM "ScopeAsset" WHERE "programId"='preasset-program' AND "normalizedValue"='api.example.test'`;
  await client.$executeRaw`INSERT INTO "ReconArtifact" (id,"scanRunId","scopeAssetId",kind,"canonicalKey",value,"scopeState",verification,sources,"firstSeenAt","lastSeenAt") SELECT 'preplan-artifact','preplan-auth-scan',id,'endpoint','preplan-endpoint','{"url":"https://api.example.test/orders/1001"}'::jsonb,'IN_SCOPE','OBSERVED','[]'::jsonb,now(),now() FROM "ScopeAsset" WHERE "programId"='preasset-program' AND "normalizedValue"='api.example.test'`;
  await client.$executeRaw`INSERT INTO "ReconSurfaceObservation" (id,"scanRunId","scopeAssetId","contextKey","contextType","canonicalKey",url,method,"statusCode","responseClass",source) SELECT 'preplan-observation','preplan-auth-scan',id,'ANONYMOUS','ANONYMOUS','GET:fixture','https://api.example.test/orders/1001','GET',200,'CONTENT','fixture' FROM "ScopeAsset" WHERE "programId"='preasset-program' AND "normalizedValue"='api.example.test'`;
  await client.$executeRaw`UPDATE "BountyProgram" SET "assessmentMode"='WHITE_BOX' WHERE id='preasset-program'`;
  await client.$executeRaw`INSERT INTO "AssessmentSource" (id,"programId",label,kind,locator,"updatedAt") VALUES ('retired-source','preasset-program','Historical source','GIT_REPOSITORY','https://internal-admin.example.local/repo',now())`;
  await client.$executeRaw`UPDATE "ScanRun" SET "assessmentSourcesSnapshot"='[{"id":"retired-source","locator":"https://internal-admin.example.local/repo"}]'::jsonb WHERE id='preplan-auth-scan'`;
  const preplan={run:await client.$queryRaw`SELECT * FROM "ScanRun" WHERE id='preplan-auth-scan'`,artifacts:await client.$queryRaw`SELECT * FROM "ReconArtifact" WHERE id='preplan-artifact'`,observations:await client.$queryRaw`SELECT * FROM "ReconSurfaceObservation" WHERE id='preplan-observation'`};
  await cp(join('prisma/migrations','20261104190000_research_plans'),join(temp,'migrations','20261104190000_research_plans'),{recursive:true});
  migrate(join(temp,'schema.prisma'));
  await client.$executeRaw`INSERT INTO "ResearchPlan" (id,"targetId","programId","scanRunId","sourceFingerprint","methodologyVersion","assessmentMode",metadata) VALUES ('historical-white-plan','preasset-host','preasset-program','preplan-auth-scan','historical-fixture','research-plan/1','WHITE_BOX','{"legacy":true}'::jsonb)`;
  const historicalPlan=await client.$queryRaw`SELECT * FROM "ResearchPlan" WHERE id='historical-white-plan'`;
  migrate(schema);
  assert.deepEqual(await client.$queryRaw`SELECT * FROM "ResearchPlan" WHERE id='historical-white-plan'`,historicalPlan);
  assert.equal((await client.finding.findUniqueOrThrow({where:{id:'upgrade-finding'}})).lifecycle,null,'Never invent a historical lifecycle');
  assert.equal(await client.findingLifecycleEvent.count(),0,'Never invent historical decisions');
  assert.equal(await client.findingRetest.count(),0,'Never invent historical retests');
  assert.equal(await client.reconHistoryRun.count(),0,'Historical runs are indexed from recorded observations, never fabricated by migration');
  assert.equal(await client.evidenceRecord.count(),0,'Never backfill Vault content or evidence identities from historical raw fields');
  assert.equal(await client.researchCoverage.count(),0,'Never backfill coverage from historical observations');
  assert.equal(await client.researchCoverageEvent.count(),0,'Never invent completed historical tests');
  const upgradedRun=await client.$queryRaw`SELECT * FROM "ScanRun" WHERE id='preplan-auth-scan'`;assert.deepEqual(upgradedRun,preplan.run);
  assert.deepEqual(await client.$queryRaw`SELECT * FROM "ReconArtifact" WHERE id='preplan-artifact'`,preplan.artifacts);
  assert.deepEqual(await client.$queryRaw`SELECT * FROM "ReconSurfaceObservation" WHERE id='preplan-observation'`,preplan.observations);
  assert.equal(await client.researchPlan.count(),1,'Keep only the historical plan; never invent plans during migration');
  assert((await client.researchSession.findMany({select:{researchPlanId:true}})).every(session=>session.researchPlanId===null));
  assert((await client.researchHypothesis.findMany({select:{planItemId:true}})).every(h=>h.planItemId===null));
  assert.deepEqual(await client.$queryRaw`SELECT id,"targetId",label,mode,purpose,"sessionStatus","sessionCheckedAt","sessionExpiresAt","cookiesCipher","headerCipher","emailCipher","passwordCipher","sessionCookiesCipher","createdAt" FROM "TargetCredential" ORDER BY id`,beforeAuthentication);
  const upgradedCredential=await client.targetCredential.findUniqueOrThrow({where:{id:'preauth-credential'}});
  assert.equal(upgradedCredential.persona,null);assert.equal(upgradedCredential.reconEnabled,false);
  assert.equal(decryptSecret(upgradedCredential.cookiesCipher),JSON.stringify({session:'UPGRADE_SESSION_FIXTURE'}));
  assert((await client.scanRun.findMany({where:{id:{not:"preplan-auth-scan"}},select:{authenticatedContextsSnapshot:true,authenticatedReconResult:true}})).every(run=>run.authenticatedContextsSnapshot===null&&run.authenticatedReconResult===null));
  assert.equal(await client.reconSurfaceObservation.count(),1,'Keep the actual captured context observation without inventing older context');
  assert.deepEqual(await client.$queryRaw`SELECT id,"ownerId","scopeRules","outOfScope","createdAt","updatedAt" FROM "BountyProgram" ORDER BY id`, beforeAssessment.programs);
  assert.deepEqual(await client.$queryRaw`SELECT id,"programId",status,outcome,"scopeMarkdown","createdAt" FROM "TargetReconRun" ORDER BY id`, beforeAssessment.parents);
  assert.deepEqual(await client.$queryRaw`SELECT id,"authorizationSnapshot","scopeMarkdown",files,"updatedAt" FROM "ResearchSession" ORDER BY id`, beforeAssessment.research);
  assert.deepEqual(await client.$queryRaw`SELECT id,"targetId","scanRunId",title,"updatedAt" FROM "Finding" ORDER BY id`, beforeAssessment.findings);
  assert((await client.bountyProgram.findMany({select:{assessmentMode:true}})).every(program=>program.assessmentMode==='BLACK_BOX'));
  assert((await client.scanRun.findMany({where:{id:{not:"preplan-auth-scan"}},select:{assessmentModeSnapshot:true,assessmentSourcesSnapshot:true}})).every(run=>run.assessmentModeSnapshot===null&&run.assessmentSourcesSnapshot===null));
  assert.deepEqual(await client.$queryRaw`SELECT "assessmentModeSnapshot","assessmentSourcesSnapshot" FROM "TargetReconRun"`,[{assessmentModeSnapshot:null,assessmentSourcesSnapshot:null}]);
  assert.equal(await client.assessmentSource.count(),1,'Keep historical source records');
  assert.equal((await client.assessmentSource.findUniqueOrThrow({where:{id:'retired-source'}})).active,false);
  await assert.rejects(client.bountyProgram.update({where:{id:'preasset-program'},data:{assessmentMode:'WHITE_BOX'}}));
  await assert.rejects(client.assessmentSource.update({where:{id:'retired-source'},data:{active:true}}));
  assert.deepEqual(await client.$queryRaw`SELECT id,model,endpoint,"promptVersion","sourceFingerprint",input,status,"createdAt" FROM "ReconSummary" ORDER BY id`,priorSummaries);
  assert.deepEqual((await client.reconSummary.findMany({orderBy:{id:'asc'},select:{provider:true}})).map(row=>row.provider),['OLLAMA','OLLAMA','OLLAMA']);
  assert.deepEqual((await client.aiProviderConfig.findMany({where:{userId:'upgrade-user',isActive:true},select:{provider:true}})).map(row=>row.provider),['OPENROUTER']);
  await assert.rejects(client.aiProviderConfig.update({where:{id:'older-ai'},data:{isActive:true}}));
  assert.deepEqual(await client.$queryRaw`SELECT id,"originalValue","normalizedValue",format,type,"assetValue","typeSource","createdAt","updatedAt" FROM "ScopeAsset" ORDER BY id`,assetBefore);
  assert.equal(await client.targetReconRun.count(),1,'Keep the one pre-assessment parent; do not invent parent Recon history');
  assert.equal(await client.reconArtifact.count(),1,'Keep the pre-plan artifact without inventing older scanner artifacts');
  const oldRun=await client.scanRun.findUniqueOrThrow({where:{id:'preasset-scan'}});
  assert.equal(oldRun.targetReconRunId,null);assert.equal(oldRun.reconPlan,null);assert.equal(oldRun.artifactVersion,0);assert.equal(oldRun.scopeMarkdown,null);
  assert.deepEqual(await client.$queryRaw`SELECT id,status,"createdAt","reconCorpus" FROM "ScanRun" WHERE id='preasset-scan'`, preasset);
  const assets = await client.scopeAsset.findMany({where:{programId:'preasset-program'},orderBy:{normalizedValue:'asc'},include:{executionTarget:true}});
  assert.equal(assets.length,2); assert.equal(assets.find(a=>a.normalizedValue==='api.example.test').assetValue,'CRITICAL');assert.equal(assets.find(a=>a.normalizedValue==='*.example.test').assetValue,'MEDIUM');
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
  assert.deepEqual(research.authorizationSnapshot,{assessmentMode:'WHITE_BOX',authorizedSources:[{locator:'https://internal-admin.example.local/repo'}]});
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
  const outcomes = await client.scanRun.findMany({ where:{id:{not:"preplan-auth-scan"}},select: { outcome: true } });
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
  const unconfigured = await client.bountyProgram.create({ data: { ownerId: "upgrade-user", companyName: "Unconfigured", requiredUserAgent: "" } });
  assert.equal(unconfigured.requiredUserAgent, "");
  await assert.rejects(client.bountyProgram.create({ data: { ownerId: "upgrade-user", companyName: "Invalid", requiredUserAgent: "   " } }));
  const p = await client.bountyProgram.create({ data: { ownerId: "upgrade-user", companyName: "Rewards", requiredUserAgent: "Program/1", rewardCritical: "9999999999999999.99" } });
  assert.equal(p.rewardCritical.toString(), "9999999999999999.99");
  // M5 cache is additive and must not touch historical snapshots or policy clocks.
  assert.equal(await client.targetScopeContext.count(),0,'Never backfill current documents from historical snapshots');
  const cacheSnapshotBefore=(await client.researchSession.findFirstOrThrow()).scopeMarkdown;
  const cacheProgramBefore=await client.bountyProgram.findUniqueOrThrow({where:{id:p.id}});
  await client.targetScopeContext.create({data:{programId:p.id,policyFingerprint:'fixture-policy',sourceFingerprint:'fixture-source',rendererVersion:3,markdown:'# Current fixture',markdownSha256:'fixture-hash',generatedAt:new Date()}});
  assert.deepEqual((await client.bountyProgram.findUniqueOrThrow({where:{id:p.id}})).updatedAt,cacheProgramBefore.updatedAt,'Publishing context must not manufacture Research policy drift');
  assert.equal((await client.researchSession.findFirstOrThrow()).scopeMarkdown,cacheSnapshotBefore);
  console.log("Additive upgrade passed: scan/finding/report/item/credential identities preserved, legacy UA remains unknown, Phase 1 ResearchSession unchanged, legacy hypothesis/session/revision preserved, nullable proof/authorization and no promotion backfill, DB preserves an unconfigured UA and rejects malformed configured values, decimal money stays exact.");
  await modernResearchUpgrade(url, client);
} finally { await client.$disconnect(); }
