// All services and all test databases are created here and removed in finally.
// No existing container, configured application DB or Redis is ever reused.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
const exec = promisify(execFile);
const prefix = `bughunter-queue-test-${randomUUID().slice(0, 8)}`;
const containers = [];
const docker = async (...args) => (await exec("docker", args, { timeout: args[0] === "run" ? 90_000 : 30_000 })).stdout.trim();
async function unusedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function ready(name, args) {
  const end = Date.now() + 25_000;
  while (Date.now() < end) {
    try { await docker("exec", name, ...args); return; } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  throw new Error(`Disposable service ${name} did not become ready`);
}
async function run(args, env, command = "npm") {
  const child = spawn(command, args, { env, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  if (code !== 0) throw new Error(`npm ${args.join(" ")} exited ${code}`);
}
try {
  const pg = `${prefix}-pg`, redis = `${prefix}-redis`, executionRedis = `${prefix}-execution-redis`, abuseRedis = `${prefix}-abuse-redis`;
  // Pin Redis’s disposable port: Docker can reassign an ephemeral mapping on start.
  const fixedRedisPort = await unusedPort(), executionRedisPort = await unusedPort(), abuseRedisPort = await unusedPort();
  for (const [name, args] of [
    [pg, [...(process.env.TEST_POSTGRES_TMPFS === '1' ? ['--tmpfs', '/var/lib/postgresql/data'] : []), "-e", "POSTGRES_PASSWORD=disposable-test", "-p", "127.0.0.1::5432", "postgres:16-alpine"]],
    [abuseRedis, ["-p", `127.0.0.1:${abuseRedisPort}:6379`, "redis:7-alpine"]],
    [executionRedis, ["-p", `127.0.0.1:${executionRedisPort}:6379`, "redis:7-alpine"]],
    [redis, ["-p", `127.0.0.1:${fixedRedisPort}:6379`, "redis:7-alpine", "redis-server", "--appendonly", "yes", "--appendfsync", "always"]],
  ]) {
    containers.push(name); // Also clean a container created before a slow start times out.
    await docker("run", "-d", "--name", name, "--label", "bughunter.queue-test=disposable", ...args);
  }
  await Promise.all([ready(pg, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"]), ready(redis, ["redis-cli", "ping"]), ready(executionRedis, ["redis-cli", "ping"]), ready(abuseRedis, ["redis-cli", "ping"])]);
  const pgPort = (await docker("port", pg, "5432/tcp")).split(":").at(-1);
  const redisPort = (await docker("port", redis, "6379/tcp")).split(":").at(-1);
  for (const db of ["queue_test", "api_test", "migration_test", "execution_test", "abuse_test", "shadow_test"]) await docker("exec", pg, "createdb", "-U", "postgres", db);
  const dbUrl = name => `postgresql://postgres:disposable-test@127.0.0.1:${pgPort}/${name}`;
  const env = { ...process.env, LOG_LEVEL: "silent", TEST_ABUSE_DATABASE_URL: dbUrl("abuse_test"), TEST_ABUSE_REDIS_URL: `redis://127.0.0.1:${abuseRedisPort}`, TEST_ABUSE_REDIS_CONTAINER: abuseRedis, TEST_DATABASE_URL: dbUrl("api_test"), TEST_QUEUE_DATABASE_URL: dbUrl("queue_test"), TEST_EXECUTION_DATABASE_URL: dbUrl("execution_test"), TEST_EXECUTION_REDIS_URL: `redis://127.0.0.1:${executionRedisPort}`, TEST_MIGRATION_DATABASE_URL: dbUrl("migration_test"), TEST_QUEUE_REDIS_URL: `redis://127.0.0.1:${redisPort}`, TEST_QUEUE_REDIS_CONTAINER: redis };
  await run(["test"], env);
  await run(["run", "test:migration"], env);
  await run(['prisma', 'migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema-datamodel', 'prisma/schema.prisma', '--shadow-database-url', dbUrl('shadow_test'), '--exit-code'], env, 'npx');
  if (process.argv.includes('--target-browser')) await run(['tests/e2e/targetAssetWorkflow.mjs'], env, process.execPath);
  if (process.argv.includes("--research-browser")) await run(["tests/e2e/researchWorkflow.mjs"], env, process.execPath);
  if (process.argv.includes("--auth-browser")) await run(["tests/e2e/authHardening.mjs"], env, process.execPath);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const name of containers.reverse()) {
    try { await docker("rm", "-f", "-v", name); } catch { console.error(`Failed to remove disposable service ${name}`); process.exitCode = 1; }
  }
}
