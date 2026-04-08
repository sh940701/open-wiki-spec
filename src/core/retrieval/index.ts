// Retrieval engine - plan 05

// Types are re-exported from src/types/retrieval.ts
export type {
  RetrievalQuery,
  Classification,
  Confidence,
  ScoredCandidate,
  SequencingSummary,
  RetrievalResult,
} from '../../types/retrieval.js';

// Internal types
export type {
  SignalType,
  ScoringSignal,
  ScoringWeights,
  ClassificationThresholds,
} from './constants.js';

export { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from './constants.js';

export { retrieve } from './retrieve.js';
export type { RetrievalOptions } from './retrieve.js';
export { lexicalRetrieval } from './lexical.js';
export { graphExpand } from './graph-expand.js';
export { scoreCandidates } from './scoring.js';
export { classify } from './classify.js';
export { isActiveChangeStatus, findSystemByTerm, titleSimilarity } from './helpers.js';
