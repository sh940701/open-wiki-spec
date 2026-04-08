import { describe, it, expect, vi } from 'vitest';
import { createEmbedder, type Embedder } from '../../../src/core/embedding/embedder.js';

describe('Embedder', () => {
  it('returns null embedder when @huggingface/transformers is not available', async () => {
    const embedder = await createEmbedder({ loadModel: false });
    // When model is not loaded, embed returns null
    expect(embedder.available).toBe(false);
    const result = await embedder.embed('test text');
    expect(result).toBeNull();
  });

  it('creates an embedder with a mock pipeline', async () => {
    const mockVector = Array.from({ length: 384 }, (_, i) => i * 0.001);
    const mockPipeline = async (_text: string) => mockVector;

    const embedder = await createEmbedder({ pipeline: mockPipeline });
    expect(embedder.available).toBe(true);

    const result = await embedder.embed('hello world');
    expect(result).toEqual(mockVector);
    expect(result!.length).toBe(384);
  });

  it('embeds batch of texts using mock pipeline', async () => {
    const mockPipeline = async (text: string) =>
      Array.from({ length: 384 }, (_, i) => i * 0.001 + text.length * 0.0001);

    const embedder = await createEmbedder({ pipeline: mockPipeline });
    const results = await embedder.embedBatch(['hello', 'world', 'test']);

    expect(results.length).toBe(3);
    results.forEach((r) => {
      expect(r).not.toBeNull();
      expect(r!.length).toBe(384);
    });
  });

  it('embedBatch returns nulls when not available', async () => {
    const embedder = await createEmbedder({ loadModel: false });
    const results = await embedder.embedBatch(['a', 'b']);
    expect(results).toEqual([null, null]);
  });
});
