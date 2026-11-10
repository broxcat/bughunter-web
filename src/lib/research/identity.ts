import { createHash } from "node:crypto";
import { z } from "zod";
export const targetIdentity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
export function targetWorkspaceId(id:string){return `research_${targetIdentity.parse(id)}`;}
export const sha256=(text:string|Buffer)=>createHash("sha256").update(text).digest("hex");
