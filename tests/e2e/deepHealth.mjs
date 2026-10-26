import assert from "node:assert/strict";
import { chromium } from "playwright-chromium";
import { execFileSync } from "node:child_process";
const app = process.env.TEST_APP_URL;
assert(app && /^http:\/\/127\.0\.0\.1:3104$/.test(app), "Use only the disposable health test app on 3104");
assert.equal(process.env.AUDIT_HEALTH_OUTAGE, "1", "Explicitly opt into stopping only the named disposable audit Redis");
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const context = await browser.newContext();
  assert.equal((await context.request.get(`${app}/api/health`)).status(), 200);
  execFileSync("docker", ["stop", "bughunter-deep-audit-redis"], { stdio: "pipe" });
  const started = Date.now(); const response = await context.request.get(`${app}/api/health`, { timeout: 3000 });
  assert.equal(response.status(), 503); assert(Date.now() - started < 2500);
  assert.deepEqual(await response.json(), { status: "error", db: "up", redis: "down" });
  console.log(`PASS: health returns 503 in ${Date.now() - started}ms when isolated Redis is unavailable`);
} finally { execFileSync("docker", ["start", "bughunter-deep-audit-redis"], { stdio: "pipe" }); await browser.close(); }
