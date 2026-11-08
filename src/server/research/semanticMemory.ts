import { z } from 'zod';
import { semanticRank } from '@/lib/research/semanticRank';
import type { HarnessSource } from '@/lib/research/workflow';
import { ResearchError } from './workspace';

const embeddings = z.object({ embeddings: z.array(z.array(z.number().finite()).min(1).max(4096)).max(41) });

export function embeddingConfiguration() {
  const raw = process.env.RESEARCH_EMBEDDING_URL?.trim();
  const model = process.env.RESEARCH_EMBEDDING_MODEL?.trim();
  if (!raw || !model || !/^[A-Za-z0-9_.:/-]{1,200}$/.test(model)) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
  return { endpoint: url.toString().replace(/\/+$/, '') + '/api/embed', model };
}

export async function retrieveSemanticMemory(query: string, corpus: HarnessSource[], signal: AbortSignal) {
  const config = embeddingConfiguration();
  if (!config) throw new ResearchError('Configure the Research embedding service before running the harness.', 422);
  if (!corpus.length) return [];
  const candidates = corpus.slice(0, 40);
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, input: [query.slice(0, 2000), ...candidates.map(item => item.text.slice(0, 1200))] }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
      redirect: 'error',
    });
    if (!response.ok || !response.body) throw new Error('Embedding unavailable');
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 4 * 1024 * 1024) throw new Error('Embedding response too large');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel(); }
    const parsed = embeddings.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (parsed.embeddings.length !== candidates.length + 1) throw new Error('Embedding count mismatch');
    return semanticRank(parsed.embeddings, 6).map(row => candidates[row.index]);
  } catch {
    throw new ResearchError('The Research embedding service did not return usable vectors. Check its configuration and model.', 503);
  }
}
