import { describe, it, expect } from 'vitest';
import { computeSemanticRecall } from '../../../src/core/embedding/semantic-recall.js';
import { createEmptyCache, setCachedVector } from '../../../src/core/embedding/cache.js';
import type { Embedder } from '../../../src/core/embedding/embedder.js';

function mockEmbedder(queryVector: number[]): Embedder {
  return {
    available: true,
    embed: async () => queryVector,
    embedBatch: async (texts) => texts.map(() => queryVector),
  };
}

// Helper: create a 384-dim vector with a known pattern
function makeVector(seed: number): number[] {
  return Array.from({ length: 384 }, (_, i) => Math.sin(i * seed));
}

describe('computeSemanticRecall', () => {
  it('returns matching candidates above threshold', async () => {
    const queryVec = makeVector(1.0);
    const embedder = mockEmbedder(queryVec);
    const cache = createEmptyCache('test-model');

    // Similar vector (same seed) → high cosine
    setCachedVector(cache, 'note-similar', makeVector(1.0), 'h1');
    // Different vector → low cosine
    setCachedVector(cache, 'note-different', makeVector(50.0), 'h2');

    const result = await computeSemanticRecall('test query', cache, embedder);

    expect(result.scores.has('note-similar')).toBe(true);
    expect(result.scores.get('note-similar')).toBeCloseTo(1.0, 2);
    // note-different may or may not be in results depending on threshold
  });

  it('returns empty when embedder is not available', async () => {
    const embedder: Embedder = {
      available: false,
      embed: async () => null,
      embedBatch: async (texts) => texts.map(() => null),
    };
    const cache = createEmptyCache('m');
    setCachedVector(cache, 'note-1', makeVector(1.0), 'h1');

    const result = await computeSemanticRecall('test', cache, embedder);
    expect(result.scores.size).toBe(0);
  });

  it('returns empty when cache has no entries', async () => {
    const embedder = mockEmbedder(makeVector(1.0));
    const cache = createEmptyCache('m');

    const result = await computeSemanticRecall('test', cache, embedder);
    expect(result.scores.size).toBe(0);
  });

  it('respects topK limit', async () => {
    const queryVec = makeVector(1.0);
    const embedder = mockEmbedder(queryVec);
    const cache = createEmptyCache('m');

    // Add many similar vectors
    for (let i = 0; i < 50; i++) {
      setCachedVector(cache, `note-${i}`, makeVector(1.0 + i * 0.01), `h${i}`);
    }

    const result = await computeSemanticRecall('test', cache, embedder, { topK: 10 });
    expect(result.scores.size).toBeLessThanOrEqual(10);
  });

  it('applies minimum score floor', async () => {
    const queryVec = makeVector(1.0);
    const embedder = mockEmbedder(queryVec);
    const cache = createEmptyCache('m');

    setCachedVector(cache, 'note-high', makeVector(1.0), 'h1');
    setCachedVector(cache, 'note-low', makeVector(100.0), 'h2');

    const result = await computeSemanticRecall('test', cache, embedder, {
      topK: 50,
      minScore: 0.5,
    });

    for (const [, score] of result.scores) {
      expect(score).toBeGreaterThanOrEqual(0.5);
    }
  });
});
