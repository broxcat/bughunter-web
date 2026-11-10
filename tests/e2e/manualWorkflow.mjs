// Run only against the disposable DB created by runManualWorkflow.mjs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { chromium } from "playwright-chromium";
assert.equal(
  new URL(process.env.DATABASE_URL).pathname,
  "/manual_workflow_test",
);
const p = new PrismaClient();
let app, browser;
const provider = createServer((req, res) => {
  res.writeHead(
    req.headers.authorization === "Bearer fixture-key" ? 200 : 401,
    { "content-type": "application/json" },
  );
  res.end("{}");
});
try {
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const endpoint = `http://127.0.0.1:${provider.address().port}/v1`;
  const owner = await p.user.create({
    data: {
      email: "manual@example.test",
      passwordHash: await bcrypt.hash("fixture-password", 4),
    },
  });
  const program = await p.bountyProgram.create({
    data: {
      ownerId: owner.id,
      companyName: "Manual workflow fixture",
      requiredUserAgent: "Fixture/1",
      outOfScope: ["blocked.example.test"],
      scopeRules: ["allowed.example.test"],
    },
  });
  const other = await p.bountyProgram.create({
    data: {
      ownerId: owner.id,
      companyName: "Other Target",
      requiredUserAgent: "Fixture/1",
    },
  });
  const scope = await p.scope.create({
    data: {
      userId: owner.id,
      hostPattern: "allowed.example.test",
      status: "APPROVED",
    },
  });
  const asset = await p.scopeAsset.create({
    data: {
      programId: program.id,
      originalValue: "allowed.example.test",
      normalizedValue: "allowed.example.test",
      format: "SUBDOMAIN",
      type: "WEB_APPLICATION",
    },
  });
  const target = await p.target.create({
    data: {
      userId: owner.id,
      programId: program.id,
      scopeId: scope.id,
      scopeAssetId: asset.id,
      host: "allowed.example.test",
      active: true,
    },
  });
  const run = await p.targetReconRun.create({
    data: {
      programId: program.id,
      status: "COMPLETED",
      outcome: "SUCCESS",
      scopeMarkdown: "# Handoff",
    },
  });
  const scan = await p.scanRun.create({
    data: {
      targetId: target.id,
      scopeAssetId: asset.id,
      targetReconRunId: run.id,
      type: "RECON",
      status: "COMPLETED",
      outcome: "SUCCESS",
      artifactVersion: 2,
      scopeAssetSnapshot: {
        assetId: asset.id,
        normalizedValue: asset.normalizedValue,
      },
    },
  });
  for (const host of [
    "new.example.test",
    "blocked.example.test",
    "allowed.example.test",
  ])
    await p.reconArtifact.create({
      data: {
        scanRunId: scan.id,
        scopeAssetId: asset.id,
        kind: "hostname",
        canonicalKey: host,
        value: { hostname: host },
        scopeState: "OUT_OF_SCOPE",
        verification: "OBSERVED",
        sources: [],
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
  await p.researchSession.create({
    data: {
      userId: owner.id,
      targetId: target.id,
      workspaceId: "research_" + target.id,
      status: "ARCHIVED",
      targetHost: target.host,
      programName: program.companyName,
      scopeMarkdown: "# Historical",
    },
  });
  const originalSessions = await p.researchSession.count();
  app = spawn(
    "node",
    ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1"],
    { stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  let output = "";
  app.stdout.on("data", (b) => (output += b));
  app.stderr.on("data", (b) => (output += b));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:3000/login")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw new Error(output);
  }
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({
    viewport: { width: 1360, height: 1000 },
  });
  await page.goto("http://127.0.0.1:3000/login");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/targets");
  assert.equal(
    await page.getByText("Search targets", { exact: true }).count(),
    0,
  );
  assert.equal(await page.getByText("Next page", { exact: true }).count(), 0);
  await page.goto("http://127.0.0.1:3000/targets/" + program.id);
  await page
    .getByRole("button", { name: "Delete target", exact: true })
    .waitFor();
  assert.equal(
    await page.locator('[aria-label="Campaign stages"] li').count(),
    4,
  );
  await page.goto("http://127.0.0.1:3000/recon");
  assert.equal(await page.getByText("Latest run", { exact: true }).count(), 0);
  assert.equal(
    await page.getByText("Search targets", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("link", { name: /Open recon|Open latest/ })
    .first()
    .click();
  await page.goto("http://127.0.0.1:3000/recon/runs/" + run.id);
  const box = page.getByRole("checkbox", { name: "Select new.example.test" });
  await box.waitFor();
  assert.equal(await box.isChecked(), false);
  assert.equal(await page.getByRole("checkbox").count(), 1);
  assert.equal(
    await p.scopeAsset.count({ where: { programId: program.id } }),
    1,
  );
  await box.check();
  await page.getByRole("button", { name: "Add selected to scope" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Selected hosts added" })
    .waitFor();
  assert.equal(
    await p.scopeAsset.count({ where: { programId: program.id } }),
    2,
  );
  const excluded = await page.request.post(
    "http://127.0.0.1:3000/api/recon/runs/" + run.id + "/scope",
    { data: { hosts: ["blocked.example.test"] } },
  );
  assert.equal(excluded.status(), 409);
  await page.goto("http://127.0.0.1:3000/research?program=" + program.id);
  await page.getByRole("heading", { name: "Manual Research" }).waitFor();
  assert.equal(await p.researchSession.count(), originalSessions);
  assert.equal(await page.getByRole("button", { name: /console/i }).count(), 0);
  await page.getByRole("link", { name: /Record a finding/ }).click();
  await page.locator("summary").filter({ hasText: "Add a finding" }).click();
  await page
    .getByRole("button", { name: "Add finding", exact: true })
    .waitFor();
  await page.goto("http://127.0.0.1:3000/settings");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("OPENAI");
  assert.equal(
    await page.getByLabel("Base URL").inputValue(),
    "https://api.openai.com/v1",
  );
  await page.getByLabel("API key", { exact: true }).fill("fixture-key");
  await page.getByLabel("Model", { exact: true }).fill("fixture-model");
  await page.getByLabel("Base URL").fill(endpoint);
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "Connected" }).waitFor();
  await page
    .getByRole("button", { name: "Save provider", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Configured OPENAI provider" })
    .waitFor();
  assert(!(await page.content()).includes("fixture-key"));
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  assert.equal(
    await page.getByLabel("API key", { exact: true }).inputValue(),
    "",
  );
  await page.getByLabel("Model", { exact: true }).fill("edited-model");
  await page
    .getByRole("button", { name: "Save provider", exact: true })
    .click();
  await page.getByText("model: edited-model").waitFor();
  await page
    .getByRole("group", { name: "Configured OPENAI provider" })
    .getByRole("button", { name: "Test connection" })
    .click();
  await page.getByRole("status").filter({ hasText: "Connected" }).waitFor();
  await mkdir("/tmp/manual-workflow-artifacts", { recursive: true });
  await page.screenshot({
    path: "/tmp/manual-workflow-artifacts/settings.png",
    fullPage: true,
  });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "deleted" }).waitFor();
  assert.equal(
    await p.aiProviderConfig.count({ where: { userId: owner.id } }),
    0,
  );
  await page.goto("http://127.0.0.1:3000/targets/" + program.id);
  await page
    .getByRole("button", { name: "Delete target", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await page.waitForURL("**/targets?deleted=1");
  assert.equal(await p.bountyProgram.count({ where: { id: program.id } }), 0);
  assert.equal(await p.bountyProgram.count({ where: { id: other.id } }), 1);
  console.log(
    "PASS: Target dashboard/deletion, Recon selection/exclusions, manual Research/Findings, AI provider CRUD/connection, no Research runtime.",
  );
} finally {
  await browser?.close();
  app?.kill("SIGTERM");
  provider.close();
  await p.$disconnect();
}
