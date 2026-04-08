export { cosineSimilarity } from './similarity.js';
export {
  loadEmbeddingCache,
  saveEmbeddingCache,
  getCachedVector,
  setCachedVector,
  createEmptyCache,
  type EmbeddingCache,
  type EmbeddingCacheEntry,
} from './cache.js';
export {
  createEmbedder,
  DEFAULT_MODEL,
  type Embedder,
  type EmbedPipeline,
  type CreateEmbedderOptions,
} from './embedder.js';
export {
  computeSemanticRecall,
  type SemanticRecallResult,
  type SemanticRecallOptions,
} from './semantic-recall.js';
