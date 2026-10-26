// Local read-only audit target. Never records cookies, tokens, bodies or query values.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
const requests = [];
const fixtureSessions = new Set();
createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://e2e-deep-audit.test");
  if (u.pathname === "/__audit/summary") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ requests })); return; }
  requests.push({ host: req.headers.host, method: req.method, path: u.pathname, ua: req.headers["user-agent"] });
  if (u.pathname === "/login") {
    if (req.method === "POST") { const session = randomUUID(); fixtureSessions.add(session); res.setHeader("Set-Cookie", `fixture_session=${session}; HttpOnly; SameSite=Lax; Path=/`); res.end("Signed in to isolated fixture"); return; }
    res.setHeader("Content-Type", "text/html"); res.end('<html><form method="POST" action="/login"><label>Email<input type="email" name="email"></label><label>Password<input type="password" name="password"></label><button type="submit">Sign in</button></form></html>'); return;
  }
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); res.end("Read-only fixture"); return; }
  if (u.pathname === "/redirect") { res.writeHead(302, { location: "http://e2e-foreign-audit.test/foreign" }); res.end(); return; }
  if (u.pathname === "/api/objects/123") {
    res.setHeader("Content-Type", "application/json");
    if (!fixtureSessions.has(/(?:^|;\s*)fixture_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1])) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
    res.end('{"id":123,"ownerId":"test-account-b","document":"Non-sensitive audit fixture"}'); return;
  }
  if (u.pathname === "/.git/HEAD") { res.writeHead(404); res.end("Not exposed"); return; }
  res.setHeader("Content-Type", "text/html");
  if (u.pathname === "/search") { const text = (u.searchParams.get("q") ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"); res.end(`<html><body><p>${text}</p></body></html>`); return; }
  if (req.headers.host === "e2e-public-audit.test") { res.end('<html><title>E2E Public Fixture</title><a href="/search?q=public">Search</a></html>'); return; }
  res.end('<html><title>E2E Local Fixture</title><body><a href="/search?q=1">Search</a><a href="/api/objects/123">Object</a><a href="/redirect">Redirect</a><a href="http://e2e-foreign-audit.test/discovered">Foreign discovery</a><form method="POST" action="/purchase"><input name="quantity"></form><script>const unused="innerHTML location postMessage";</script></body></html>');
}).listen(Number(process.env.PORT ?? 80), "0.0.0.0");
