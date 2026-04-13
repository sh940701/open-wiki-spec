import type { NoteType } from './notes.js';

export interface RetrievalQuery {
  intent: 'add' | 'modify' | 'remove' | 'query';
  summary: string;
  feature_terms: string[];
  system_terms: string[];
  entity_terms: string[];
  status_bias: string[];
}

export type Classification = 'existing_change' | 'existing_feature' | 'new_feature' | 'needs_confirmation';
export type Confidence = 'high' | 'medium' | 'low';

export interface ScoredCandidate {
  id: string;
  type: NoteType;
  title: string;
  score: number;
  reasons: string[];
  status?: string;
  path?: string;
}

export interface SequencingSummary {
  status: 'parallel_safe' | 'needs_review' | 'conflict_candidate' | 'conflict_critical' | 'blocked';
  related_changes: string[];
  reasons: string[];
}

export interface RetrievalResult {
  query: string;
  classification: Classification;
  confidence: Confidence;
  sequencing: SequencingSummary;
  candidates: ScoredCandidate[];
  warnings: string[];
  /**
   * Human-readable justification for the chosen classification/confidence
   * pair. Especially important for `needs_confirmation` — without this
   * field, agents (and users reading `--json`) have no way to tell WHY
   * the engine asked for confirmation (top-two tie? sequencing conflict?
   * under-specified query? index quality issues?). Always set by
   * `classify()` so downstream consumers can trust its presence.
   */
  classification_reason?: string;
  /**
   * Whether semantic (embedding-based) search was available for this
   * retrieval run. When false, results are lexical-only — lower recall
   * for semantically-similar but lexically-different queries. JSON
   * consumers (CI, agents) can use this to decide whether the
   * classification is trustworthy enough to auto-act on.
   */
  semantic_used?: boolean;
}
