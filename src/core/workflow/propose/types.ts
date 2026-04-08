import type { Classification, Confidence, RetrievalResult, ScoredCandidate, RetrievalQuery } from '../../../types/retrieval.js';
import type { SequencingResult } from '../../../types/sequencing.js';
import type { VaultIndex, IndexRecord } from '../../../types/index-record.js';
import type { RetrievalOptions } from '../../retrieval/retrieve.js';

// ── Query Object (overview.md section 10.4) ──

export type LocalIntent = 'add' | 'modify' | 'fix' | 'remove' | 'investigate';

export interface QueryObject {
  intent: LocalIntent;
  summary: string;
  feature_terms: string[];
  system_terms: string[];
  entity_terms: string[];
  status_bias: string[];
  override_keywords?: string[];
}

// ── Classification wrapper ──

export interface ClassificationResult {
  classification: Classification;
  confidence: Confidence;
  primary_candidate: ScoredCandidate | null;
  secondary_candidate: ScoredCandidate | null;
  reasons: string[];
}

// ── Preflight ──

export interface PreflightResult {
  retrieval: RetrievalResult;
  sequencingFull: SequencingResult;
}

// ── Planned prerequisites ──

export interface PlannedPrerequisites {
  hard: {
    why_present: boolean;
    delta_summary_present: boolean;
    tasks_present: boolean;
    validation_present: boolean;
  };
  soft: {
    design_approach_present: boolean;
    decision_link_present: boolean;
  };
  all_hard_met: boolean;
  warnings: string[];
}

// ── Propose result ──

export type ProposeAction =
  | 'continued_change'
  | 'created_change'
  | 'created_feature_and_change'
  | 'asked_user';

export interface ProposeResult {
  action: ProposeAction;
  retrieval: RetrievalResult;
  classification: ClassificationResult;
  target_change: { id: string; path: string; status: string } | null;
  target_feature: { id: string; path: string } | null;
  prerequisites: PlannedPrerequisites | null;
  transitioned_to_planned: boolean;
  sequencing_warnings: string[];
}

// ── Dependency injection ──

export interface ProposeDeps {
  buildIndex: (vaultRoot: string) => Promise<VaultIndex> | VaultIndex;
  retrieve: (index: VaultIndex, query: RetrievalQuery, options?: RetrievalOptions) => RetrievalResult;
  analyzeSequencing: (records: Map<string, IndexRecord>) => SequencingResult;
  parseNote: (filePath: string) => import('../../parser/types.js').ParseResult;
  writeFile: (filePath: string, content: string) => void;
  readFile: (filePath: string) => string;
}

export interface ProposeOptions {
  vaultRoot: string;
  forceClassification?: Classification;
  forceTargetId?: string;
  dryRun?: boolean;
  keywords?: string[];
  /** When true, allow note creation even for needs_confirmation classification. */
  confirm?: boolean;
}
