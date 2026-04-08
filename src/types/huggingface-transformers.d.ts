/**
 * Minimal type declarations for @huggingface/transformers (optional dependency).
 * Only the subset used by src/core/embedding/embedder.ts is declared.
 */
declare module '@huggingface/transformers' {
  export interface PipelineOptions {
    dtype?: string;
  }

  export interface FeatureExtractionOutput {
    data: Float32Array;
  }

  export type FeatureExtractionPipeline = (
    text: string,
    options?: { pooling?: string; normalize?: boolean },
  ) => Promise<FeatureExtractionOutput>;

  export function pipeline(
    task: 'feature-extraction',
    model: string,
    options?: PipelineOptions,
  ): Promise<FeatureExtractionPipeline>;
}
