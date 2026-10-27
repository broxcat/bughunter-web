// Disposable infrastructure only. No real target, user SSH key or app database.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, copyFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
const exec = promisify(execFile), project = `bh-research-test-${randomUUID().slice(0, 8)}`;
const temp = await mkdtemp(join(tmpdir(), project)), config = join(temp, "compose.json");
const cmd = async (file, args, options = {}) => (await exec(file, args, { timeout: 60000, maxBuffer: 2 ** 20, ...options })).stdout.trim();
const compose = (...args) => cmd("docker", ["compose", "-p", project, "-f", config, ...args]);
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loopHypothesis } from "../fixtures/researchLoop.mjs";
import { fakeBurp } from "./fakeBurp.mjs";
let started = false, tunnel, burpFixture, mcp;
try {
  const original = JSON.parse(await cmd("docker", ["compose", "--profile", "research", "config", "--format", "json"]));
  const runner = original.services["research-runner"];
  assert.equal(runner.ports[0].host_ip, "127.0.0.1");
  assert.equal(runner.ports[0].published, process.env.RESEARCH_SSH_PORT ?? "2222");
  assert(!runner.env_file);
  assert(!JSON.stringify(runner).match(/docker\.sock|DATABASE_URL|AUTH_SECRET|REDIS_URL|CREDENTIALS_ENCRYPTION_KEY/));
  assert.deepEqual(Object.keys(runner.networks), ["research_egress"]);
  // Testing service is derived from the real service: preserve capabilities,
  // user, entrypoint and healthcheck, change only disposable resources/port.
  delete runner.build;
  delete runner.profiles;
  runner.restart = "no";
  const listener = createServer();
  await new Promise(r => listener.listen(0, "127.0.0.1", r));
  runner.ports[0].published = String(listener.address().port);
  await new Promise(r => listener.close(r)); // fixed port survives container restarts
  runner.volumes = [
    { type: "volume", source: "workspaces", target: "/workspaces" },
    { type: "volume", source: "codex", target: "/home/researcher/.codex" },
    { type: "volume", source: "hostkeys", target: "/etc/ssh/host-keys" },
    { type: "bind", source: join(temp, "authorized_keys"), target: "/run/research-keys/authorized_keys", read_only: true },
  ];
  await cmd("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(temp, "key")]);
  await copyFile(join(temp, "key.pub"), join(temp, "authorized_keys"));
  await writeFile(config, JSON.stringify({ services: {
    "research-runner": runner,
    db: { image: "postgres:16-alpine", environment: { POSTGRES_PASSWORD: "disposable-research" }, networks: ["backend"] },
    redis: { image: "redis:7-alpine", networks: ["backend"] },
  }, networks: { research_egress: {}, backend: {} }, volumes: { workspaces: {}, codex: {}, hostkeys: {} } }));
  await compose("up", "-d"); started = true;
  const id = await compose("ps", "-q", "research-runner");
  const dexec = (...args) => cmd("docker", ["exec", id, ...args]);
  let healthy = false;
  for (let i = 0; i < 40; i++) {
    try { await dexec("healthcheck"); healthy = true; break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!healthy) {
    console.error(await compose("logs", "--no-color", "research-runner"));
    throw new Error("Runner must pass its real healthcheck");
  }
  const inspected = JSON.parse(await cmd("docker", ["inspect", id]))[0];
  const bindings = inspected.NetworkSettings.Ports["22/tcp"];
  assert(bindings.every(b => b.HostIp === "127.0.0.1"));
  assert(!JSON.stringify(inspected.Config.Env).match(/AUTH_SECRET|DATABASE_URL|REDIS_URL|CREDENTIALS_ENCRYPTION_KEY|GITHUB_SECRET|GOOGLE_SECRET/));
  assert(!JSON.stringify(inspected.Mounts).includes("docker.sock"));
  assert.deepEqual(Object.keys(inspected.NetworkSettings.Networks), [`${project}_research_egress`]);
  const sshd = await dexec("/usr/sbin/sshd", "-T");
  for (const setting of ["permitrootlogin no", "passwordauthentication no", "kbdinteractiveauthentication no", "pubkeyauthentication yes", "allowusers researcher", "authenticationmethods publickey", "allowtcpforwarding remote", "permitlisten 127.0.0.1:9876", "gatewayports no", "permitopen none", "allowstreamlocalforwarding no"]) assert(sshd.includes(setting));
  assert((await dexec("id", "researcher")).includes("uid=2000"));
  const version = await dexec("su", "-s", "/bin/sh", "researcher", "-c", "codex --version");
  await dexec("su", "-s", "/bin/sh", "researcher", "-c", "codex --help");
  await dexec("su", "-s", "/bin/sh", "researcher", "-c", "codex --yolo --help");
  // Generate the actual exporter bundle on the host, copy it to emulate web's
  // volume publication, then set the same root/research ownership as the web.
  const output = JSON.parse(await cmd("npx", ["tsx", "tests/research/createWorkspace.mts", join(temp, "export")]));
  const workspace = `/workspaces/${output.workspaceId}`;
  await cmd("docker", ["cp", join(temp, "export", output.workspaceId), `${id}:${workspace}`]);
  await dexec("chown", "-R", "root:research", workspace);
  await dexec("chmod", "3770", "/workspaces");
  const port = bindings[0].HostPort;
  const sshArgs = ["-i", join(temp, "key"), "-p", port, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", `UserKnownHostsFile=${join(temp, "known_hosts")}`];
  const ssh = command => cmd("ssh", [...sshArgs, "researcher@127.0.0.1", command]);
  assert((await ssh("id -un")).includes("researcher"));
  assert((await ssh("bughunter-workspaces")).includes("app.example.test"));
  const help = await ssh(`cd ${workspace} && bughunter-codex --help`);
  assert(help.includes("Codex CLI")); assert(help.includes(output.workspaceId));

  const codexConfig = await ssh(`cd ${workspace} && bughunter-codex mcp get bughunter_burp --json`);
  assert(codexConfig.includes('"command": "/usr/local/bin/bughunter-burp-mcp"'));
  assert(codexConfig.includes(workspace));
  const status = () => ssh(`cd ${workspace} && bughunter-burp-status`);
  await assert.rejects(status()); // optional upstream is absent; runner remains healthy
  await dexec("healthcheck");
  const absent = JSON.parse(await ssh(`cat ${workspace}/research/burp-status.json`));
  assert.equal(absent.upstream, "UNAVAILABLE");
  burpFixture = await fakeBurp();
  // The remote listen is fixed by sshd. The host fixture uses a disposable port.
  tunnel = spawn("ssh", [...sshArgs, "-N", "-o", "ExitOnForwardFailure=yes", "-R", `127.0.0.1:9876:127.0.0.1:${burpFixture.port}`, "researcher@127.0.0.1"], { stdio: "ignore" });
  for (let i = 0; i < 20; i++) { try { await status(); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  assert((await status()).includes("AVAILABLE"));
  const listening = await dexec("python3", "-c", "import socket; s=socket.socket(); s.connect(('127.0.0.1',9876)); print('loopback tunnel open')");
  assert(listening.includes("loopback tunnel open"));
  const sockets = await dexec("cat", "/proc/net/tcp");
  const burpListen = sockets.split("\n").filter(line => line.includes(":2694") && line.trim().split(/\s+/)[3] === "0A");
  assert.equal(burpListen.length, 1); assert(burpListen[0].includes("0100007F:2694")); // 9876, loopback only
  await assert.rejects(cmd("ssh", [...sshArgs, "-N", "-o", "ExitOnForwardFailure=yes", "-R", "127.0.0.1:9877:127.0.0.1:1", "researcher@127.0.0.1"], { timeout: 5000 }));
  await assert.rejects(cmd("ssh", [...sshArgs, "-N", "-o", "ExitOnForwardFailure=yes", "-R", "0.0.0.0:9876:127.0.0.1:1", "researcher@127.0.0.1"], { timeout: 5000 }));
  mcp = new Client({ name: "bughunter-runner-fixture", version: "1.0.0" });
  await mcp.connect(new StdioClientTransport({ command: "ssh", args: [...sshArgs, "researcher@127.0.0.1", `cd ${workspace} && bughunter-burp-mcp`], stderr: "pipe" }));
  const tools = await mcp.listTools();
  assert.deepEqual(tools.tools.map(t => t.name), ["burp_status", "burp_history", "burp_save_observation"]);
  assert(!JSON.stringify(tools).match(/send_http|UNTRUSTED_IGNORE_SCOPE/));
  const called = await mcp.callTool({ name: "burp_history", arguments: { count: 2, offset: 0 } });
  const history = JSON.parse(called.content[0].text);
  assert.equal(history.items.length, 1); assert.equal(history.items[0].requiredUserAgentMatches, true);
  assert(!JSON.stringify(history).match(/SECRET|DELETE ALL|discovered\.example/));
  assert(burpFixture.calls.every(call => call.name === "get_proxy_http_history_regex"));
  const saved = await mcp.callTool({ name: "burp_save_observation", arguments: { observationId: history.items[0].observationId } });
  const ref = JSON.parse(saved.content[0].text).ref;
  const evidence = JSON.parse(await ssh(`cat ${workspace}/${ref}`));
  assert.equal(evidence.findingCreated, false); assert.equal(evidence.source, "BURP_MCP");
  assert.equal((await mcp.callTool({ name: "send_http1_request", arguments: {} })).isError, true);
  assert.equal((await mcp.callTool({ name: "burp_history", arguments: { url: "http://example.test", command: "bash" } })).isError, true);
  await mcp.close(); mcp = null;
  tunnel.kill("SIGTERM"); tunnel = null;
  await burpFixture.close(); burpFixture = null;
  const validate = () => ssh(`cd ${workspace} && bughunter-validate-hypotheses`);
  assert((await validate()).includes("OK — 0 hypotheses"));
  const writeHypotheses = value => ssh(`cd ${workspace} && printf '%s' '${Buffer.from(JSON.stringify(value)).toString("base64")}' | base64 -d > research/hypotheses.json`);
  const validHypothesis = { externalId: "H-001", title: "Local fixture hypothesis", status: "OPEN", hypothesis: "An observed local boundary may differ.", evidenceFor: [{ ref: "scope.md", summary: "Local synthetic observation reference." }], evidenceAgainst: [], nextTest: "Compare two fixture observations.", expectedSignal: "Distinct controlled responses.", falsificationCondition: "Identical access enforcement." };
  await writeHypotheses({ version: 1, sessionId: "session", hypotheses: [validHypothesis] });
  assert((await validate()).includes("OK — 1 hypotheses"));
  const invalidHypothesis = { ...validHypothesis }; delete invalidHypothesis.falsificationCondition;
  await writeHypotheses({ version: 1, sessionId: "session", hypotheses: [invalidHypothesis] });
  await assert.rejects(validate());
  await writeHypotheses({ version: 1, sessionId: "session", hypotheses: [{ ...validHypothesis, evidenceFor: [{ ref: "evidence/missing.txt", summary: "Uncaptured observation" }] }] });
  await assert.rejects(validate());

  await ssh(`cd ${workspace} && printf '%s' '{"version":99,"sessionId":"session","hypotheses":[]}' > research/hypotheses.json`);
  await assert.rejects(validate());
  await ssh(`cd ${workspace} && printf '%s' '{"version":1,"sessionId":"session","hypotheses":[]}' > research/hypotheses.json`);
  assert((await validate()).includes("OK — 0 hypotheses"));

  for (const name of ["positive", "control"]) await ssh(`printf 'Synthetic local observation only' > ${workspace}/evidence/${name}.txt`);
  const loop = loopHypothesis({ status: "CONFIRMED" });
  await writeHypotheses({ version: 2, sessionId: "session", hypotheses: [loop] });
  assert((await validate()).includes("OK — 1 hypotheses"));
  loop.tests[0].observations[0].evidence = [{ ref, summary: "Burp status metadata alone cannot confirm a security effect." }];
  await writeHypotheses({ version: 2, sessionId: "session", hypotheses: [loop] }); await assert.rejects(validate());
  loop.host = "discovered.example.test";
  await writeHypotheses({ version: 2, sessionId: "session", hypotheses: [loop] }); await assert.rejects(validate());
  await writeHypotheses({ version: 2, sessionId: "session", hypotheses: [] });
  await assert.rejects(ssh("cd /home/researcher && bughunter-codex --help"));
  await assert.rejects(cmd("ssh", [...sshArgs, "root@127.0.0.1", "id"]));
  // Only publickey is accepted. A client explicitly refusing publickey cannot log in.
  await assert.rejects(cmd("ssh", [...sshArgs, "-o", "PubkeyAuthentication=no", "researcher@127.0.0.1", "id"]));
  await ssh(`cd ${workspace} && printf 'Local fixture note\n' >> research/notes.md`);
  await assert.rejects(ssh(`printf overwrite > ${workspace}/scope.md`));
  await assert.rejects(ssh(`mv ${workspace} /workspaces/forbidden-rename`));
  await compose("restart", "research-runner");
  for (let i = 0; i < 20; i++) { try { await ssh("true"); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  assert((await ssh(`cat ${workspace}/research/notes.md`)).includes("Local fixture note"));
  for (const service of ["db", "redis"]) {
    const serviceId = await compose("ps", "-q", service);
    const peer = JSON.parse(await cmd("docker", ["inspect", serviceId]))[0];
    const ip = Object.values(peer.NetworkSettings.Networks)[0].IPAddress;
    const script = `import socket; s=socket.socket(); s.settimeout(2); result=s.connect_ex(('${ip}',${service === "db" ? 5432 : 6379})); assert result != 0, 'backend reachable'`;
    await dexec("su", "-s", "/bin/sh", "researcher", "-c", `python3 -c "${script}"`);
  }
  // Internet egress / registry connectivity, never an actual research target.
  await dexec("su", "-s", "/bin/sh", "researcher", "-c", "curl --fail --silent --max-time 20 https://registry.npmjs.org/@openai%2fcodex > /dev/null");
  assert(!(await readFile(resolve("src/app/api/research-sessions/route.ts"), "utf8")).match(/execFile|spawn|exec\(/));
  console.log(`${version}; --yolo, bughunter-codex --help and hypotheses validator (valid/invalid) verified over SSH`);
  console.log(`SSH binding verified: 127.0.0.1:${port} only (production Compose: 127.0.0.1:${process.env.RESEARCH_SSH_PORT ?? "2222"})`);
  console.log("Burp passive MCP stdio/SSE, restricted reverse SSH loopback tunnel, Codex MCP config, optional absence, redacted evidence and denied active tools passed using a local fixture (not real Burp Suite). ");
  console.log("Public-key/non-root SSH, denied password/root login, immutable inputs, writable notes, restart persistence, absent app secrets/socket, backend isolation and Internet egress passed.");
} catch (error) {
  // Child-process errors may contain captured output; do not dump full configs.
  console.error(`Research infrastructure failed: ${error.message.split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  await mcp?.close().catch(() => {});
  tunnel?.kill("SIGTERM");
  await burpFixture?.close().catch(() => {});
  if (started) await compose("down", "-v", "--remove-orphans").catch(() => { process.exitCode = 1; });
  await rm(temp, { recursive: true, force: true });
}
