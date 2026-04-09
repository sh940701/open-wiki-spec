/**
 * Embedding model wrapper with graceful degradation.
 * Uses @huggingface/transformers when available, otherwise returns null vectors.
 */

export const DEFAULT_MODEL = 'Xenova/multilingual-e5-small';

/**
 * Pinned model revision (commit hash) on HuggingFace Hub.
 * Update this hash when intentionally upgrading the model version.
 * For air-gapped environments, set CreateEmbedderOptions.localModelPath
 * to a local directory containing the model files instead.
 */
export const DEFAULT_MODEL_REVISION = 'bf4b30e4e5543f3949ad93f84e0b12c40feb1528';

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
  /**
   * Model revision (commit hash) to pin downloads to a specific version.
   * Defaults to DEFAULT_MODEL_REVISION.
   */
  revision?: string;
  /**
   * Local filesystem path to a pre-downloaded model directory.
   * When set, the model is loaded from disk instead of downloading from HuggingFace Hub.
   * Recommended for air-gapped or security-sensitive environments.
   */
  localModelPath?: string;
}

/**
 * Create an embedder instance.
 * When @huggingface/transformers is not installed or loadModel is false,
 * returns a no-op embedder (available: false).
 */
export async function createEmbedder(
  options: CreateEmbedderOptions = {},
): Promise<Embedder> {
  const {
    loadModel = true,
    pipeline: injectedPipeline,
    model = DEFAULT_MODEL,
    revision = DEFAULT_MODEL_REVISION,
    localModelPath,
  } = options;

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
    const modelSource = localModelPath ?? model;
    const pipelineOpts: Record<string, unknown> = { dtype: 'q8' };
    if (!localModelPath && revision) {
      pipelineOpts.revision = revision;
    }
    const extractor = await pipeline('feature-extraction', modelSource, pipelineOpts);

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
