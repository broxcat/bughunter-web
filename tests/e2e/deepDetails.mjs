import assert from "node:assert/strict";
import { chromium } from "playwright-chromium";
import { readFile, writeFile } from "node:fs/promises";
const app = process.env.TEST_APP_URL ?? "http://localhost:3103";
assert(/^http:\/\/(localhost|127\.0\.0\.1):3103$/.test(app));
if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) { console.error("E2E_AUTH_UNAVAILABLE: E2E_EMAIL and E2E_PASSWORD are required."); process.exit(2); }
const { programId, hostId, company } = JSON.parse(await readFile("/tmp/deep-audit-objects.json", "utf8")); assert(company.startsWith("E2E Deep Audit Target "));
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]}); const context=await browser.newContext(); const page=await context.newPage(); const results=[];
const record=(scenario,pass,notes="")=>{results.push({scenario,result:pass?"PASS":"FAIL",notes});console.log(`${pass?"PASS":"FAIL"}: ${scenario}${notes?` — ${notes}`:""}`)};
try{
  await page.goto(`${app}/login`);await page.getByLabel("Email",{exact:true}).fill(process.env.E2E_EMAIL);await page.getByLabel("Password",{exact:true}).fill(process.env.E2E_PASSWORD);await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL(`${app}/targets`);
  const findings=await(await context.request.get(`${app}/api/findings?targetId=${hostId}`)).json();const finding=findings.find(f=>f.huntMetadata?.evidenceLevel==="CONFIRMED");assert(finding,"Requires a confirmed result from the actual local-fixture Hunt");
  await page.goto(`${app}/targets/${hostId}/findings`); const item=page.locator("li").filter({has:page.getByText(finding.title,{exact:true})}).first();
  if(finding.gateStatus!=="PASSED"){
    for(const name of [/Can an attacker use this RIGHT NOW/,/Is the impact on the program/,/Is the root cause/,/Can you prove impact beyond/,/session|identit/i]){
      const checkbox=item.getByRole("checkbox",{name}); if(await checkbox.count()===1)await checkbox.check();
    }
    // Use the public gate's exact pass polarity, not an invented all-true gate.
    const gate=await import("../../src/lib/gate.ts").catch(()=>null);
    if(gate){for(const q of gate.GATE_QUESTIONS)await item.getByRole("checkbox",{name:q.text,exact:true}).setChecked(q.passWhen)}
    else{
      const labels=await item.locator("label").allTextContents();for(const label of labels){const c=item.getByLabel(label,{exact:true});if(await c.count()===1)await c.setChecked(!/require privileged|already known|only work|already disclosed|intended functionality/i.test(label));}
    }
    await item.getByRole("button",{name:"Run gate",exact:true}).click();
  }
  await page.reload(); const refreshed=await(await context.request.get(`${app}/api/findings?targetId=${hostId}`)).json(); record("actual fixture confirmed finding remains confirmed",refreshed.find(f=>f.id===finding.id)?.huntMetadata?.evidenceLevel==="CONFIRMED");
  const reportTitle=`E2E Deep Audit Report ${Date.now()}`;
  await page.goto(`${app}/targets/${hostId}/report`); await page.getByPlaceholder("Report title",{exact:true}).fill(reportTitle);const choice=page.getByRole("checkbox",{name:new RegExp(finding.title.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"))});
  await choice.first().check();const generated=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/reports"&&r.request().method()==="POST");await page.getByRole("button",{name:"Generate report",exact:true}).click();assert.equal((await generated).status(),201);await page.getByRole("heading",{name:"Generated markdown",exact:true}).waitFor();record("report generated from confirmed local fixture finding",true);
  const saved=await(await context.request.get(`${app}/api/reports`)).json();assert(saved.some(r=>r.title===reportTitle));record("report persisted in backend",true);
  await page.reload();await page.waitForLoadState("networkidle");record("report remains accessible after refresh",await page.getByText(reportTitle,{exact:false}).count()>0);
  for(const size of [{width:1920,height:1080},{width:1366,height:768},{width:390,height:844}]){await page.setViewportSize(size);record(`report layout ${size.width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
  await page.goto(`${app}/hunt?program=${programId}`);await page.getByLabel("Company",{exact:true}).selectOption(programId);const approval=page.getByText("Optional bounded timing tests — explicit approval",{exact:true});await approval.click();const checkboxes=page.getByRole("checkbox",{name:/I explicitly approve bounded/});record("approvals default off",(await checkboxes.all()).length>0 && !(await Promise.all((await checkboxes.all()).map(c=>c.isChecked()))).some(Boolean));
  if(await checkboxes.count())await checkboxes.first().check();await page.reload();await page.waitForLoadState("networkidle");await approval.click();record("approval does not survive a refreshed new-run form",!(await Promise.all((await page.getByRole("checkbox",{name:/I explicitly approve bounded/}).all()).map(c=>c.isChecked()))).some(Boolean));
}catch(e){record("detail execution",false,`${e.name}: ${String(e.message).replaceAll(process.env.E2E_PASSWORD,"[REDACTED]").slice(0,450)}`);process.exitCode=1}
finally{await writeFile("/tmp/deep-details-results.json",JSON.stringify(results,null,2));await browser.close()}
if(results.some(r=>r.result==="FAIL"))process.exitCode=1;
