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
 *
 * Verify any new hash points to a commit that actually exists in the model
 * repo (the previous value did not) and contains all required files
 * (tokenizer.json, config.json, quantized ONNX weights).
 */
export const DEFAULT_MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';

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
 * In-flight embedder promises keyed by model identity so concurrent
 * `propose` calls within the same Node process share a single load —
 * avoiding a redundant model download/initialization on cold start.
 *
 * We can't dedupe across separate Node processes from JavaScript (that
 * would need a filesystem lock), but transformers.js already caches
 * model files on disk, so the cost of two parallel processes is a
 * one-time race on the cache directory, not a full double download.
 * Within a single process (tests, long-lived server wrappers, repeated
 * CLI invocations via programmatic API) this latch prevents the
 * pathological case of two proposes each spawning a full initialization.
 */
const inFlightEmbedders = new Map<string, Promise<Embedder>>();

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

  // If a mock pipeline is injected, use it directly.
  // Apply the same empty-string guard as the real model path so tests
  // and the null embedder see the same contract: whitespace-only input
  // returns null rather than a garbage vector.
  if (injectedPipeline) {
    const guardedInjected = async (text: string): Promise<number[] | null> => {
      if (!text || text.trim().length === 0) return null;
      return injectedPipeline(text);
    };
    return {
      available: true,
      embed: guardedInjected,
      embedBatch: async (texts: string[]) => Promise.all(texts.map(guardedInjected)),
    };
  }

  if (!loadModel) {
    return createNullEmbedder();
  }

  // Singleton-per-model: if another caller in this process has already
  // kicked off an initialization for the same model/revision/path tuple,
  // wait on that promise instead of spawning a duplicate load. Failures
  // are cached too (we clear on error so a retry can try again).
  const cacheKey = `${localModelPath ?? ''}|${model}|${revision ?? ''}`;
  const existing = inFlightEmbedders.get(cacheKey);
  if (existing) return existing;

  const loadPromise = loadEmbedderInternal(model, revision, localModelPath);
  inFlightEmbedders.set(cacheKey, loadPromise);
  try {
    return await loadPromise;
  } catch (err) {
    // Clear on error so the next call can retry rather than permanently
    // inheriting a failed load.
    inFlightEmbedders.delete(cacheKey);
    throw err;
  }
}

async function loadEmbedderInternal(
  model: string,
  revision: string | undefined,
  localModelPath: string | undefined,
): Promise<Embedder> {
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

    // Empty-string guard. transformers.js on an empty input produces a
    // degenerate zero-norm vector and emits a warning; that zero vector
    // then pollutes cosine similarity (everything looks like a 0.0 match
    // instead of being filtered out). Match the null-embedder contract
    // and return `null` for empty/whitespace-only inputs so callers
    // can skip scoring cleanly.
    const guardedEmbed = async (text: string): Promise<number[] | null> => {
      if (!text || text.trim().length === 0) return null;
      return embedFn(text);
    };

    return {
      available: true,
      embed: guardedEmbed,
      embedBatch: async (texts: string[]) => Promise.all(texts.map(guardedEmbed)),
    };
  } catch (err) {
    // Surface the failure so users know embedding is degraded.
    // Verbose mode emits full error; default emits one-line warning.
    const message = (err as Error).message ?? String(err);
    if (process.env.OWS_DEBUG === '1' || process.env.OWS_VERBOSE === '1') {
      process.stderr.write(`[ows] Embedding model failed to load: ${message}\n`);
      if ((err as Error).stack) {
        process.stderr.write(`${(err as Error).stack}\n`);
      }
      process.stderr.write('[ows] Falling back to lexical-only retrieval (semantic search disabled).\n');
    } else {
      process.stderr.write(`[ows] Warning: embedding model unavailable (${message}). Using lexical retrieval only.\n`);
    }
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
