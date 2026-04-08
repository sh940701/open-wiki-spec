import type { EmbeddingCache } from './cache.js';
import type { Embedder } from './embedder.js';
import { cosineSimilarity } from './similarity.js';

export interface SemanticRecallOptions {
  /** Max number of candidates to return. Default: 20 */
  topK?: number;
  /** Minimum cosine similarity to include. Default: 0.5 */
  minScore?: number;
}

export interface SemanticRecallResult {
  /** Cosine similarities per note ID (keys = candidate IDs). */
  scores: ReadonlyMap<string, number>;
}

/**
 * Find semantically similar notes by comparing query embedding against cached note embeddings.
 * Returns topK candidates above minScore, sorted by similarity descending.
 */
export async function computeSemanticRecall(
  querySummary: string,
  cache: EmbeddingCache,
  embedder: Embedder,
  options?: SemanticRecallOptions,
): Promise<SemanticRecallResult> {
  const topK = options?.topK ?? 20;
  const minScore = options?.minScore ?? 0.5;
  const emptyResult: SemanticRecallResult = { scores: new Map() };

  if (!embedder.available) return emptyResult;

  const queryVector = await embedder.embed(querySummary);
  if (!queryVector) return emptyResult;

  const entries = Object.entries(cache.entries);
  if (entries.length === 0) return emptyResult;

  // Compute similarities for all cached entries
  const scored: Array<{ id: string; score: number }> = [];
  for (const [id, entry] of entries) {
    if (!entry.vector || entry.vector.length !== queryVector.length) continue;
    const sim = cosineSimilarity(queryVector, entry.vector);
    if (sim >= minScore) {
      scored.push({ id, score: sim });
    }
  }

  // Sort by score descending, take topK
  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, topK);

  const scores = new Map<string, number>();
  for (const { id, score } of topResults) {
    scores.set(id, score);
  }

  return { scores };
}
