import { ResearchError } from './research/workspace';

/** Bounded metadata bodies; do not accept source contents or credentials. */
export async function assessmentRequestBody(req: Request): Promise<unknown> {
  const limit = 128 * 1024;
  if (Number(req.headers.get('content-length')) > limit) throw new ResearchError('Source metadata is too large', 413);
  const reader = req.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ResearchError('Source metadata is too large', 413); }
      parts.push(value);
    }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return null; }
  } finally { reader.releaseLock(); }
}
export function assessmentError(error: unknown) {
  return Response.json({ error: error instanceof ResearchError ? error.message : 'Assessment operation unavailable' }, { status: error instanceof ResearchError ? error.status : 503 });
}
