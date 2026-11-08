/** Both the query and candidates come from the same embedding model. */
export function semanticRank(vectors: number[][], limit: number) {
  const query = vectors[0];
  if (!query?.length || query.length > 4096 || vectors.some(v => v.length !== query.length || v.some(x => !Number.isFinite(x)))) {
    throw new Error('Invalid embedding dimensions');
  }
  const norm = (v: number[]) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  const queryNorm = norm(query);
  if (!queryNorm || !Number.isFinite(queryNorm)) throw new Error('Invalid query embedding');
  return vectors.slice(1).map((v, index) => {
    const magnitude = norm(v);
    const score = magnitude && Number.isFinite(magnitude)
      ? v.reduce((sum, x, i) => sum + (x / magnitude) * (query[i] / queryNorm), 0)
      : 0;
    return { index, score };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit);
}
