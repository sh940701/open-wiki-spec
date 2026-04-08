/**
 * Embedding model wrapper with graceful degradation.
 * Uses @huggingface/transformers when available, otherwise returns null vectors.
 */

export const DEFAULT_MODEL = 'Xenova/multilingual-e5-small';

export type EmbedPipeline = (text: string) => Promise<number[]>;

export interface Embedder {
  available: boolean;
  embed: (text: string) => Promise<number[] | null>;
  embedBatch: (texts: string[]) => Promise<(number[] | null)[]>;
}

export interface CreateEmbedderOptions {
  /** If false, skip model loading (for testing). */
  loadModel?: boolean;
  /** Inject a mock pipeline (for testing). */
  pipeline?: EmbedPipeline;
  /** Model name override. */
  model?: string;
}

/**
 * Create an embedder instance.
 * When @huggingface/transformers is not installed or loadModel is false,
 * returns a no-op embedder (available: false).
 */
export async function createEmbedder(
  options: CreateEmbedderOptions = {},
): Promise<Embedder> {
  const { loadModel = true, pipeline: injectedPipeline, model = DEFAULT_MODEL } = options;

  // If a mock pipeline is injected, use it directly
  if (injectedPipeline) {
    return {
      available: true,
      embed: async (text: string) => injectedPipeline(text),
      embedBatch: async (texts: string[]) =>
        Promise.all(texts.map((t) => injectedPipeline(t))),
    };
  }

  if (!loadModel) {
    return createNullEmbedder();
  }

  // Try to load @huggingface/transformers dynamically
  try {
    const { pipeline } = await import('@huggingface/transformers');
    const extractor = await pipeline('feature-extraction', model, {
      dtype: 'q8',
    });

    const embedFn: EmbedPipeline = async (text: string) => {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data as Float32Array);
    };

    return {
      available: true,
      embed: async (text: string) => embedFn(text),
      embedBatch: async (texts: string[]) =>
        Promise.all(texts.map((t) => embedFn(t))),
    };
  } catch {
    return createNullEmbedder();
  }
}

function createNullEmbedder(): Embedder {
  return {
    available: false,
    embed: async () => null,
    embedBatch: async (texts: string[]) => texts.map(() => null),
  };
}
