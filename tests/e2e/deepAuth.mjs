import assert from "node:assert/strict";
import { chromium } from "playwright-chromium";
import { writeFile } from "node:fs/promises";
const app = process.env.TEST_APP_URL;
assert(app && /^http:\/\/(127\.0\.0\.1|localhost):3103$/.test(app), "Use locally compiled audit app on 3103");
if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) { console.error("E2E_AUTH_UNAVAILABLE: E2E_EMAIL and E2E_PASSWORD are required."); process.exit(2); }
const selected=process.env.AUTH_AUDIT_CASE??"all";
const enabled=name=>selected==="all"||selected===name;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }); const results=[];
const context = await browser.newContext(); const page=await context.newPage();
const record=(scenario,pass)=>{results.push({scenario,result:pass?"PASS":"FAIL"});console.log(`${pass?"PASS":"FAIL"}: ${scenario}`)};
async function submit(email=process.env.E2E_EMAIL,password=process.env.E2E_PASSWORD){await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click()}
try {
  if(enabled("callback")) {
    await page.goto(`${app}/login?callbackUrl=%2Fscopes`);await submit();await page.waitForURL(`${app}/scopes`);record("valid relative post-login destination",true);
    let external=false;await context.route("https://outside.invalid/**",async route=>{external=true;await route.abort()});
    await page.goto(`${app}/login?callbackUrl=${encodeURIComponent("https://outside.invalid/never-contacted")}`);await submit();await page.waitForTimeout(1200);record("external callback refused without leaving app",!external && new URL(page.url()).origin===app && new URL(page.url()).pathname==="/targets");
  }
} finally {await writeFile(process.env.AUDIT_RESULTS_PATH??`/tmp/deep-auth-${selected}.json`,JSON.stringify(results,null,2));await browser.close()}
if(results.some(r=>r.result==="FAIL"))process.exitCode=1;
