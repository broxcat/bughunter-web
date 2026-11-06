import assert from "node:assert/strict";
import {researchAuthorizationSnapshot,researchTargetSelect} from "../../src/server/research/workspace.ts";
import { createServer } from "node:http";
import { once } from "node:events";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { chromium } from "playwright-chromium";
const app = process.env.TEST_APP_URL;
const database = process.env.TEST_DATABASE_URL;
assert(app && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(app), "Explicit local TEST_APP_URL required");
assert(database && new URL(database).pathname === "/bughunter_blackbox_e2e", "Use the dedicated disposable bughunter_blackbox_e2e database");
const prisma = new PrismaClient({ datasourceUrl: database });
const requiredUa = "BlackBox-UX-Synthetic/1";
const targetRequests = [];
const targetServer = createServer((req, res) => {
  targetRequests.push({ ua: req.headers["user-agent"], path: req.url, method: req.method });
  const valid = req.headers.cookie?.includes("session=ux-fixture-session");
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/me") { if (!valid) { res.writeHead(401); res.end('{"error":"unauthorized"}'); } else res.end('{"id":"ux-account","username":"local fixture account","authenticated":true}'); return; }
  res.setHeader("Content-Type", "text/html"); res.end('<html><title>Synthetic target</title><a href="/api/me">Account</a></html>');
});
targetServer.listen(0, "127.0.0.1"); await once(targetServer, "listening");
const fixtureHostname=process.env.TEST_BLACKBOX_HOSTNAME??'app.ux.fixture.test',host = `${fixtureHostname}:${targetServer.address().port}`;
const fixturePassword = "synthetic-browser-password";
const stamp = Date.now(); const email = `blackbox-ux-${stamp}@example.test`;
let user, browser; let checks = 0;
function pass(label) { checks++; console.log(`PASS: ${label}`); }
try {
  user = await prisma.user.create({ data: { email, name: "Black-box UX fixture", passwordHash: await bcrypt.hash(fixturePassword, 4) } });
  const program = await prisma.bountyProgram.create({ data: { ownerId: user.id, companyName: `Black-box UX ${stamp}`, requiredUserAgent: requiredUa, qualifying: ["XSS", "IDOR", "CSRF"] } });
  const scope = await prisma.scope.create({ data: { userId: user.id, hostPattern: host, status: "APPROVED" } });
  const asset=await prisma.scopeAsset.create({data:{programId:program.id,originalValue:'http://'+host+'/',normalizedValue:'http://'+host+'/',format:'URL',type:'WEB_APPLICATION'}});
  const target = await prisma.target.create({ data: { userId: user.id, programId: program.id, scopeId: scope.id, scopeAssetId:asset.id, host:fixtureHostname, scheme: "http" } });
  const finding = await prisma.finding.create({ data: { targetId: target.id, title: "Synthetic controlled finding", location:"http://"+host+"/api/me", evidence: JSON.stringify({ controls: ["BASELINE_CONTROL", "INDEPENDENT_REPEAT"], result: "Local synthetic marker" }), impact: "Read-only synthetic fixture impact" } });
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext(); const page = await context.newPage();
  await context.route("**/*", route => new URL(route.request().url()).origin === app ? route.continue() : route.abort());
  await page.goto(`${app}/login`); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(fixturePassword); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL(`${app}/targets`); pass("fixture user signs in locally");
  await page.goto(`${app}/hosts/${target.id}#authentication`); await page.getByRole("heading", { name: "Authentication", exact: true }).waitFor();
  assert.equal(await page.getByLabel(/login endpoint|login URL|CSRF token|auth header|owned object/i).count(), 0); pass("only black-box authentication inputs are exposed");
  await page.getByRole("radio", { name: "Session cookie", exact: true }).check(); await page.getByLabel("Session cookie value", { exact: true }).fill("Cookie: session=ux-fixture-session");
  const tested = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/credentials/test") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Test connection", exact: true }).first().click(); const response = await tested; assert.equal(response.status(), 200); const result = await response.json(); assert.equal(result.status, "VALID"); assert(!JSON.stringify(result).includes("ux-fixture-session"));
  await page.getByText("✓ Connected — Session valid", { exact: true }).waitFor(); assert.equal(await page.getByLabel("Session cookie value", { exact: true }).inputValue(), ""); pass("real connection validates session and clears saved cookie");
  assert(targetRequests.length > 0 && targetRequests.every(r => r.ua === requiredUa && r.method === "GET")); pass("required User-Agent is captured on every target request");
  await page.goto(`${app}/targets/${target.id}/findings`); assert.equal(await page.getByText(/7.Question|Run gate/).count(), 0);
  await page.getByRole("button", { name: "Review evidence", exact: true }).click(); await page.getByLabel("Reproduction and impact", { exact: true }).fill("The local synthetic observation reproduces under baseline and control with read-only fixture impact."); await page.getByRole("button", { name: "Confirm", exact: true }).click(); await page.getByText("CONFIRMED", { exact: true }).waitFor(); pass("candidate moves through evidence review to confirmation without questions");
  const saved = await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } }); assert.equal(saved.reviewStatus, "CONFIRMED"); assert.equal(saved.gateAnswers, null); pass("evidence decision persists without question answers");
  const selected=await prisma.target.findUniqueOrThrow({where:{id:target.id},select:researchTargetSelect});const session=await prisma.researchSession.create({data:{userId:user.id,targetId:target.id,consoleTargetId:target.id,workspaceId:'synthetic_'+crypto.randomUUID(),status:'READY',targetHost:target.host,programName:program.companyName,scopeMarkdown:'Labelled synthetic Research context; no provider started',authorizationSnapshot:researchAuthorizationSnapshot(selected)}});
  const proof=await context.request.post(app+'/api/evidence/'+target.id,{data:{kind:'HTTP_REQUEST_RESPONSE',sessionId:session.id,description:'Explicit locally observed fixture response',observedAt:new Date().toISOString(),http:{method:'GET',url:'http://'+host+'/api/me',statusCode:200},link:{entity:'finding',id:finding.id,role:'SUPPORTS'}}});assert.equal(proof.status(),201);
  for(const [expectedRevision,state]of ['VALIDATING','VALIDATED'].entries()){const response=await context.request.post(app+'/api/findings/'+finding.id+'/lifecycle',{data:{eventKey:crypto.randomUUID(),expectedRevision,state,reason:'Human reviewed locally reproduced behavior with impact and negative control',...(state==='VALIDATED'?{validation:{reproduced:true,impactDemonstrated:true,scopeRespected:true,negativeControl:'PERFORMED',conclusion:'Reproduced controlled fixture impact within the authorized local scope'}}:{})}});assert.equal(response.status(),201);}pass('explicit validation requires scope, proof and checks before Report');
  await page.goto(`${app}/targets/${target.id}/report`); await page.getByPlaceholder("Report title", { exact: true }).fill("Synthetic reviewed report"); await page.getByRole("checkbox", { name: /Synthetic controlled finding/ }).check(); await page.getByRole("button", { name: "Generate report", exact: true }).click(); await page.getByRole("heading", { name: "Generated markdown", exact: true }).waitFor(); pass("confirmed finding remains reportable");
  for (const width of [390, 1366]) { await page.setViewportSize({ width, height: 900 }); await page.goto(`${app}/hosts/${target.id}`); await page.getByRole("heading", { name: "Authentication", exact: true }).waitFor(); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); pass(`authentication layout fits ${width}px`); }
  await prisma.targetCredential.updateMany({ where: { targetId: target.id }, data: { sessionStatus: "EXPIRED" } });
  console.log(`Black-box UX: ${checks} checks passed`);
} finally {
  await browser?.close();
  await new Promise(resolve => targetServer.close(resolve));
  if (user) { await prisma.researchSession.deleteMany({where:{userId:user.id}}); await prisma.target.deleteMany({ where: { userId: user.id } }); await prisma.bountyProgram.deleteMany({ where: { ownerId: user.id } }).catch(() => {}); await prisma.user.delete({ where: { id: user.id } }).catch(() => {}); }
  await prisma.$disconnect();
}
