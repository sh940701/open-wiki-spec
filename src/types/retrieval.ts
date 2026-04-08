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
}
