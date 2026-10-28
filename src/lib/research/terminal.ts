import { createHash, randomUUID, sign, verify } from "node:crypto";
import { z } from "zod";

// Database IDs only. Neither hostnames nor client paths name a workspace/session.
export const targetIdentity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
export function targetWorkspaceId(id: string) { return `research_${targetIdentity.parse(id)}`; }
export function tmuxIdentity(id: string) { return `bughunter-${targetIdentity.parse(id)}`; }
export const terminalClaims = z.strictObject({
  v: z.literal(1), aud: z.literal("bughunter-research-terminal"),
  userId: targetIdentity, targetId: targetIdentity, sessionId: targetIdentity,
  provider: z.enum(["codex", "claude"]).optional(),
  policySha256: z.string().regex(/^[a-f0-9]{64}$/),
  iat: z.number().int(), exp: z.number().int(), nonce: z.uuid(),
});
export type TerminalClaims = z.infer<typeof terminalClaims>;
export const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
export function issueTerminalTicket(ids: Pick<TerminalClaims, "userId" | "targetId" | "sessionId" | "policySha256" | "provider">, privateKey: string, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const claims = terminalClaims.parse({ ...ids, v: 1, aud: "bughunter-research-terminal", iat, exp: iat + 30, nonce: randomUUID() });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { token: `${payload}.${sign(null, Buffer.from(payload), privateKey).toString("base64url")}`, expiresAt: claims.exp * 1000 };
}
export function verifyTerminalTicket(token: string, publicKey: string, now = Date.now()) {
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("INVALID_TICKET");
  const [payload, signature] = token.split(".");
  if (!verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, "base64url"))) throw new Error("INVALID_TICKET");
  const claims = terminalClaims.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  const seconds = Math.floor(now / 1000);
  if (claims.exp <= seconds || claims.iat > seconds + 2 || claims.exp - claims.iat !== 30) throw new Error("EXPIRED_TICKET");
  return claims;
}

const stopClaims = z.strictObject({ aud: z.literal('bughunter-research-stop'), targetId: targetIdentity,
  workspaceId: z.string().regex(/^(?:research_[A-Za-z0-9][A-Za-z0-9_-]{0,99}|[a-f0-9-]{36})$/), exp: z.number().int() });
export function issueStopTicket(targetId: string, workspaceId: string, key: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify(stopClaims.parse({ aud: 'bughunter-research-stop', targetId, workspaceId, exp: Math.floor(now / 1000) + 30 }))).toString('base64url');
  return `${payload}.${sign(null, Buffer.from(payload), key).toString('base64url')}`;
}
export function verifyStopTicket(token: string, key: string, now = Date.now()) {
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('INVALID_TICKET');
  const [payload, signature] = token.split('.');
  if (!verify(null, Buffer.from(payload), key, Buffer.from(signature, 'base64url'))) throw new Error('INVALID_TICKET');
  const claims = stopClaims.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
  if (claims.exp <= now / 1000 || claims.exp > now / 1000 + 31 || (claims.workspaceId.startsWith('research_') && claims.workspaceId !== targetWorkspaceId(claims.targetId))) throw new Error('EXPIRED_TICKET');
  return claims;
}
