import { execFileSync, spawnSync } from "node:child_process";
const prefix = "bughunter-manual-" + process.pid;
const docker = (args) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();
try {
  docker(["network", "create", prefix]);
  docker([
    "run",
    "-d",
    "--name",
    prefix + "-db",
    "--network",
    prefix,
    "--tmpfs",
    "/var/lib/postgresql/data",
    "-e",
    "POSTGRES_PASSWORD=fixture",
    "-e",
    "POSTGRES_DB=manual_workflow_test",
    "postgres:16-alpine",
  ]);
  docker([
    "run",
    "-d",
    "--name",
    prefix + "-redis",
    "--network",
    prefix,
    "redis:7-alpine",
  ]);
  for (let i = 0; i < 100; i++) {
    try {
      docker(["exec", prefix + "-db", "pg_isready", "-U", "postgres"]);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const image = process.env.MANUAL_TEST_IMAGE ?? "bughunter-web";
  const args = [
    "run",
    "--rm",
    "--name",
    prefix + "-web",
    "--security-opt",
    "label=disable",
    "--network",
    prefix,
    "-v",
    "/tmp/bughunter-ui:/tmp/manual-workflow-artifacts",
    "-v",
    process.cwd() + ":/app",
    "-v",
    "/dev/null:/app/.env:ro",
    "-v",
    process.env.HOME + "/.cache/ms-playwright:/ms-playwright:ro",
    "-e",
    "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
    "-e",
    "DATABASE_URL=postgresql://postgres:fixture@" +
      prefix +
      "-db:5432/manual_workflow_test",
    "-e",
    "REDIS_URL=redis://" + prefix + "-redis:6379",
    "-e",
    "AUTH_URL=http://127.0.0.1:3000",
    "-e",
    "AUTH_TRUST_HOST=true",
    "-e",
    "AUTH_SECRET=manual-workflow-disposable-fixture",
    "-e",
    "CREDENTIALS_ENCRYPTION_KEY=" + "ab".repeat(32),
    "-e",
    "RESEARCH_ARCHIVE_ROOT=/tmp/manual-archives",
    "-e",
    "RESEARCH_WORKSPACE_ROOT=/tmp/manual-exports",
    "-w",
    "/app",
    "--entrypoint",
    "sh",
    image,
    "-c",
    process.env.MANUAL_TEST_DATABASE_SUITE
      ? "npx prisma migrate deploy && env -u AUTH_URL NODE_ENV=test TEST_DATABASE_URL=$DATABASE_URL npm test -- --maxWorkers=1"
      : "npx prisma migrate deploy && node tests/e2e/manualWorkflow.mjs",
  ];
  const r = spawnSync("docker", args, { stdio: "inherit" });
  if (r.status !== 0) process.exitCode = 1;
} finally {
  for (const name of ["-web", "-redis", "-db"]) {
    try {
      docker(["rm", "-f", prefix + name]);
    } catch {}
  }
  try {
    docker(["network", "rm", prefix]);
  } catch {}
}
